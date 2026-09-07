/**
 * L'écran de chargement de l'application — le seul.
 *
 * Il y en avait trois, qui ne se connaissaient pas : l'ouverture de la base de
 * l'appareil, l'écran de connexion, la préparation du moteur de dictée. Entre
 * eux, trois moments où la page était simplement blanche — le chargement des
 * dossiers, la vérification de session, et l'intervalle entre la fermeture du
 * portail et l'apparition de l'interface. Sur un téléphone lent, chacun dure
 * plusieurs secondes, et une page blanche se lit comme une application cassée,
 * quoi qu'elle fasse par-dessous.
 *
 * Le remplacement n'est pas un quatrième écran écrit à l'avance, mais un
 * **modèle d'étapes** : chaque sous-système déclare ce qu'il entreprend et rend
 * compte de son avancement ; l'écran se dessine à partir de ce qu'on lui a dit,
 * et se retire tout seul quand il n'a plus rien à dire.
 *
 *   const etape = suivre("base", "Base de données de l'appareil",
 *                        { bloquante: true });
 *   etape.dire("Installation de PostgreSQL…");
 *   etape.avancer({ charge, total });
 *   etape.reussir();
 *
 * Trois règles tiennent le reste, toutes reprises de ce qui existait :
 *
 *  - **rien sous 400 ms.** Au deuxième lancement tout est en cache et la
 *    séquence dure moins d'une seconde : afficher puis retirer un écran
 *    aussitôt produirait un clignotement, plus gênant que l'attente qu'il
 *    prétend expliquer ;
 *  - **jamais d'impasse.** Dès qu'aucune étape bloquante n'est en cours, une
 *    sortie est offerte. Un poste sans accès à huggingface.co doit rester
 *    capable de rédiger au clavier ;
 *  - **jamais d'échec muet.** Une étape qui échoue le dit, avec sa raison ;
 *    bloquante, elle propose une reprise et le diagnostic.
 */
import { $, creer, icone, vider } from "./ui.js";

/**
 * Sous ce délai, l'écran n'apparaît pas du tout.
 *
 * Repris tel quel de l'ancien écran de préparation : c'est la durée en dessous
 * de laquelle un affichage se lit comme un clignotement plutôt que comme une
 * explication.
 */
const SEUIL_AFFICHAGE_MS = 400;

/**
 * Certaines étapes ne peuvent pas attendre ce seuil, et pas parce qu'elles sont
 * longues : parce qu'elles monopolisent le fil principal.
 *
 * L'ouverture de PGlite compile trois mégaoctets de WebAssembly. Mesuré : la
 * minuterie de 400 ms armée juste avant ne se déclenchait qu'à 3,1 s, une fois
 * la compilation finie — trois secondes de page vide, exactement ce que cet
 * écran existe pour éviter. Une étape marquée `immediat` s'affiche donc avant
 * de commencer, sans minuterie à faire attendre.
 */

/** @typedef {"attente"|"encours"|"faite"|"differee"|"echouee"} Etat */

/** Les étapes, dans l'ordre où elles ont été déclarées. */
const etapes = [];

let affiche = false;
let suspendu = false;
let minuterie = null;
/** Rendu différé à la frame suivante : une étape qui progresse à chaque octet
 *  reçu redessinerait sinon la liste des dizaines de fois par seconde. */
let redessinDemande = false;
/** Recours proposé par la première étape bloquante en échec. */
let reprise = null;
/** Écarté par l'utilisateur : on n'affiche plus rien de cette séquence. */
let ecarte = false;

// --- Le modèle ---

/**
 * Déclare une étape et rend la poignée qui l'alimente.
 *
 * @param {string} id identifiant stable, pour retrouver une étape déjà déclarée
 * @param {string} libelle ce que l'utilisateur lit
 * @param {{bloquante?: boolean, immediat?: boolean}} [options]
 *   bloquante : l'application ne peut pas s'ouvrir sans elle ;
 *   immediat : l'étape monopolise le fil principal, il faut l'afficher avant
 *   de la commencer (voir `AFFICHAGE_IMMEDIAT`).
 */
export function suivre(id, libelle, { bloquante = false, immediat = false } = {}) {
  let etape = etapes.find((candidate) => candidate.id === id);
  if (!etape) {
    etape = { id, libelle, bloquante, etat: "attente", detail: "", cumul: null };
    etapes.push(etape);
  }
  etape.libelle = libelle;
  etape.bloquante = bloquante;
  etape.etat = "encours";
  etape.detail = "";
  etape.cumul = null;
  if (immediat && !suspendu && !ecarte) afficher();
  reevaluer();

  return {
    /** Sous-libellé : ce qui se passe précisément en ce moment. */
    dire(detail) {
      etape.detail = detail || "";
      reevaluer();
    },
    /** Avancement chiffré, en octets. `null` remet la barre en indéterminé. */
    avancer(cumul) {
      etape.cumul = cumul && cumul.total > 0 ? cumul : null;
      reevaluer();
    },
    reussir() {
      etape.etat = "faite";
      etape.detail = "";
      etape.cumul = null;
      reevaluer();
    },
    /**
     * Ni faite, ni en échec : remise à plus tard, pour une raison assumée.
     * Sur téléphone, le modèle de dictée pèse cent quarante mégaoctets qu'on
     * n'engage pas sans qu'ils aient été demandés. Sans cet état, l'écran
     * afficherait une étape qui ne démarre jamais et paraîtrait bloqué.
     */
    differer(raison) {
      etape.etat = "differee";
      etape.detail = raison || "";
      etape.cumul = null;
      reevaluer();
    },
    /**
     * @param {string} raison message affichable, jamais vide
     * @param {{reessayer?: () => void}} [recours]
     */
    echouer(raison, { reessayer } = {}) {
      etape.etat = "echouee";
      etape.detail = raison || "";
      etape.cumul = null;
      if (etape.bloquante && reessayer) reprise = reessayer;
      reevaluer();
    },
  };
}

const enCours = (etape) => etape.etat === "encours";
const bloquee = (etape) => etape.bloquante && etape.etat === "echouee";

const echouee = (etape) => etape.etat === "echouee";

/**
 * Reste-t-il quelque chose à montrer ?
 *
 * Une étape en échec compte, y compris non bloquante : c'est le seul moment où
 * l'on peut dire pourquoi la dictée ne marchera pas sur ce poste. L'écran reste
 * alors jusqu'à ce que l'utilisateur l'écarte.
 */
function attenteEnCours() {
  return etapes.some(enCours) || etapes.some(echouee);
}

/** L'application peut-elle être révélée par-dessous ? */
function plusRienDeBloquant() {
  return !etapes.some((etape) => etape.bloquante && (enCours(etape) || bloquee(etape)));
}

// --- L'écran ---

/**
 * Suspend l'affichage sans perdre le modèle.
 *
 * Le portail attend une saisie, parfois longuement : superposer un écran
 * d'attente à un formulaire de connexion n'aurait aucun sens. Les étapes déjà
 * cochées le restent, et l'écran reprend là où il en était une fois la session
 * ouverte.
 */
export function suspendre() {
  suspendu = true;
  reevaluer();
}

export function reprendre() {
  suspendu = false;
  reevaluer();
}

/** Remet le modèle à zéro. Utilisé par les tests et par une reprise après échec. */
export function reinitialiser() {
  etapes.length = 0;
  reprise = null;
  ecarte = false;
  suspendu = false;
  reevaluer();
}

function reevaluer() {
  // Un échec bloquant reprend la main même sur un écran écarté : sans base de
  // données, il n'y a rien derrière à laisser voir.
  if (etapes.some(bloquee)) ecarte = false;

  if (suspendu || ecarte || !attenteEnCours()) {
    clearTimeout(minuterie);
    minuterie = null;
    masquer();
    return;
  }

  // Un échec bloquant n'attend pas le seuil : il n'y a plus rien à espérer,
  // autant le dire tout de suite.
  if (!affiche && etapes.some(bloquee)) {
    afficher();
  } else if (!affiche && minuterie === null) {
    minuterie = setTimeout(() => {
      minuterie = null;
      if (!suspendu && !ecarte && attenteEnCours()) afficher();
    }, SEUIL_AFFICHAGE_MS);
  }

  if (affiche) demanderRedessin();
}

function afficher() {
  const ecran = $("chargement");
  // Une page qui n'embarque pas le balisage — le diagnostic, la comparaison —
  // ne doit pas se retrouver avec un écran « affiché » qu'elle ne peut pas
  // retirer.
  if (!ecran) return;
  affiche = true;
  ecran.hidden = false;
  // L'application est parfois déjà peinte dessous : sans `inert`, elle
  // resterait navigable au clavier sous l'écran, et un lecteur d'écran la
  // lirait par-dessus.
  if ($("app")) $("app").inert = true;
  if ($("entete")) $("entete").inert = true;
  dessiner();
}

function masquer() {
  if (!affiche) return;
  affiche = false;
  const ecran = $("chargement");
  if (ecran) ecran.hidden = true;
  if ($("app")) $("app").inert = false;
  if ($("entete")) $("entete").inert = false;
}

function demanderRedessin() {
  if (redessinDemande) return;
  redessinDemande = true;
  requestAnimationFrame(() => {
    redessinDemande = false;
    if (affiche) dessiner();
  });
}

function mo(octets) {
  return `${(octets / 1024 / 1024).toFixed(0)} Mo`;
}

/** Cumul des octets des étapes qui en rendent compte. */
function cumulGlobal() {
  let charge = 0;
  let total = 0;
  for (const etape of etapes) {
    if (etape.cumul) {
      charge += etape.cumul.charge;
      total += etape.cumul.total;
    }
  }
  return total > 0 ? { charge, total } : null;
}

function dessiner() {
  const echecBloquant = etapes.some(bloquee);
  const cumul = cumulGlobal();
  const barre = $("chargement-barre");
  const chiffres = $("chargement-taille");

  // Le titre dit dans quel état on est. « Préparation de l'application » au-
  // dessus d'un message d'échec annoncerait une attente qui n'aura pas lieu.
  $("chargement-titre").textContent = echecBloquant
    ? "L'application n'a pas pu s'ouvrir"
    : "Préparation de l'application";

  // Une jauge n'a plus rien à mesurer une fois l'ouverture perdue : laissée
  // en place, elle donne l'impression que quelque chose progresse encore.
  const jauge = barre.parentElement;
  jauge.hidden = echecBloquant;
  if (echecBloquant) {
    chiffres.textContent = "";
    dessinerEtapes();
    dessinerSorties();
    return;
  }

  if (cumul) {
    const pct = Math.min(100, Math.round((cumul.charge / cumul.total) * 100));
    barre.classList.remove("chargement-barre-indeterminee");
    barre.style.width = `${pct}%`;
    barre.parentElement.setAttribute("aria-valuenow", String(pct));
    chiffres.textContent = `${mo(cumul.charge)} sur ${mo(cumul.total)}`;
  } else {
    barre.classList.add("chargement-barre-indeterminee");
    barre.style.width = "";
    barre.parentElement.removeAttribute("aria-valuenow");
    chiffres.textContent = "";
  }

  dessinerEtapes();
  dessinerSorties();
}

const ICONE_ETAT = {
  faite: "check",
  echouee: "alerte",
  differee: "chevron",
};

function dessinerEtapes() {
  const liste = $("chargement-etapes");
  vider(liste);

  for (const etape of etapes) {
    const nomIcone = ICONE_ETAT[etape.etat];
    liste.append(
      creer("li", { classe: `chargement-etape chargement-etape-${etape.etat}` }, [
        creer(
          "span",
          { classe: "chargement-puce", attrs: { "aria-hidden": "true" } },
          [nomIcone ? icone(nomIcone, "ico") : null]
        ),
        creer("span", { classe: "chargement-textes" }, [
          creer("span", { classe: "chargement-libelle", texte: etape.libelle }),
          etape.detail
            ? creer("span", { classe: "chargement-detail", texte: etape.detail })
            : null,
        ]),
      ])
    );
  }
}

/**
 * Les sorties possibles, recalculées à chaque rendu.
 *
 * Tant qu'une étape bloquante est en cours, il n'y en a aucune : l'application
 * ne peut rien montrer. Dès qu'il n'en reste plus, on peut toujours continuer —
 * c'est le principe, et il ne se durcit pas.
 */
function dessinerSorties() {
  const echecBloquant = etapes.find(bloquee);
  const passer = $("chargement-passer");
  const reessayer = $("chargement-reessayer");
  const aide = $("chargement-aide");

  aide.hidden = !etapes.some((etape) => etape.etat === "echouee");
  reessayer.hidden = !echecBloquant;
  passer.hidden = !plusRienDeBloquant();

  passer.textContent = etapes.some((etape) => etape.etat === "echouee")
    ? "Continuer sans la dictée"
    : "Continuer sans attendre";

  // Le focus va sur la sortie la première fois qu'elle paraît, et pas à chaque
  // rendu : le déplacer sous les doigts à chaque octet reçu serait intenable.
  const sortie = echecBloquant ? reessayer : passer;
  if (!sortie.hidden && !sortie.dataset.focusDonne) {
    sortie.dataset.focusDonne = "1";
    sortie.focus();
  }
}

/**
 * Branche les deux boutons de sortie. Appelé une fois au démarrage.
 */
export function initChargement() {
  const passer = $("chargement-passer");
  const reessayer = $("chargement-reessayer");
  if (!passer || !reessayer) return;

  passer.addEventListener("click", () => {
    // Le chargement continue en arrière-plan : l'éducateur n'attend plus devant
    // l'écran, mais il ne repart pas de zéro non plus.
    ecarte = true;
    reevaluer();
  });

  reessayer.addEventListener("click", () => {
    const recours = reprise;
    reprise = null;
    if (recours) recours();
    else location.reload();
  });
}

/** Pour les vérifications en navigateur : l'état du modèle, sans le DOM. */
export function etatChargement() {
  return {
    affiche,
    suspendu,
    ecarte,
    etapes: etapes.map(({ id, libelle, etat, detail, bloquante }) => ({
      id,
      libelle,
      etat,
      detail,
      bloquante,
    })),
  };
}
