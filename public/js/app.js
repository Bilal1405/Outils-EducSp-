/**
 * Assemblage de l'interface : vues, onglets, navigation, démarrage.
 *
 * Les modules de vue ne se connaissent pas ; ils publient des événements que ce
 * fichier traduit en changements d'écran.
 */
import { api } from "./api.js";
import { etat, sur } from "./etat.js";
import {
  $,
  age,
  creer,
  formatDate,
  formatDateHeure,
  icone,
  notifier,
  vider,
} from "./ui.js";
import {
  initReglages,
  appliquerEtablissement,
  appliquerEquipe,
  afficherQuota,
  estCoordinateur,
  majBandeau,
} from "./reglages.js";
import {
  initBeneficiaires,
  appliquerBeneficiaires,
  dessinerProfil,
} from "./beneficiaires.js";
import {
  initRedaction,
  restaurerBrouillon,
  brouillonNonEnvoye,
  arreterDicteeSiActive,
  planifierPreparationDictee,
} from "./redaction.js";
import { initBilan, ouvrirBilan } from "./bilan.js";
import { initParcours, ouvrirParcours, parcoursModifie } from "./parcours.js";
import { initPilotage, ouvrirJournal, ouvrirTableauDeBord } from "./pilotage.js";
import { ouvrirPortail } from "./portail.js";
import { preparerOutil } from "./preparation.js";

// --- Vues et onglets ---

function montrerVue(nom) {
  $("vue-accueil").hidden = nom !== "accueil";
  $("vue-beneficiaire").hidden = nom !== "beneficiaire";
  $("vue-parcours").hidden = nom !== "parcours";
  $("vue-pilotage").hidden = nom !== "pilotage";
  $("vue-bilan").hidden = nom !== "bilan";
  // Le parcours guidé gère sa propre hauteur : chaque étape doit tenir dans
  // l'écran, c'est lui qui décide de ce qui défile.
  $("zone-travail").classList.toggle("zone-travail-pleine", nom === "parcours");
}

function activerOnglet(nom) {
  for (const onglet of document.querySelectorAll(".onglet")) {
    onglet.setAttribute("aria-selected", onglet.dataset.onglet === nom ? "true" : "false");
  }
  $("panneau-redaction").hidden = nom !== "redaction";
  $("panneau-bilans").hidden = nom !== "bilans";
  $("panneau-profil").hidden = nom !== "profil";
}

function initOnglets() {
  const onglets = [...document.querySelectorAll(".onglet")];

  for (const onglet of onglets) {
    onglet.addEventListener("click", () => activerOnglet(onglet.dataset.onglet));

    // Flèches gauche/droite entre onglets : comportement attendu d'un
    // `tablist`, et le seul moyen d'y naviguer sans souris.
    onglet.addEventListener("keydown", (evenement) => {
      const decalage =
        evenement.key === "ArrowRight" ? 1 : evenement.key === "ArrowLeft" ? -1 : 0;
      if (decalage === 0) return;
      evenement.preventDefault();
      const index = (onglets.indexOf(onglet) + decalage + onglets.length) % onglets.length;
      onglets[index].focus();
      activerOnglet(onglets[index].dataset.onglet);
    });
  }
}

// --- Mise en route guidée ---

/**
 * L'établissement et le compte existent dès la connexion : il ne reste qu'un
 * prérequis, le premier bénéficiaire.
 */
function majAccueil() {
  const pret = etat.beneficiaires.length > 0;
  $("accueil-demarrage").hidden = pret;
  $("accueil-pret").hidden = !pret;
}

// --- Liste des bilans d'un bénéficiaire ---

function dessinerBilans() {
  const liste = $("liste-bilans");
  vider(liste);

  const compteur = $("compteur-bilans");
  compteur.hidden = etat.bilans.length === 0;
  compteur.textContent = String(etat.bilans.length);
  $("bilans-vide").hidden = etat.bilans.length > 0;

  const libelleType = (type) =>
    (etat.typesBilan.find((entree) => entree.type === type) || {}).libelle || "Bilan";

  for (const bilan of etat.bilans) {
    const valide = bilan.statut === "validé";
    const origine = bilan.source === "audio" ? "dicté" : "saisi";

    liste.append(
      creer("li", {}, [
        creer(
          "button",
          {
            classe: "bilan-ligne",
            attrs: { type: "button" },
            sur: { click: () => ouvrirDepuisListe(bilan.id) },
          },
          [
            creer("span", { classe: "bilan-ligne-icone" }, [icone("document")]),
            creer("span", { classe: "bilan-ligne-textes" }, [
              creer("span", {
                classe: "bilan-ligne-periode",
                texte: `${libelleType(bilan.type_bilan)} · ${formatDate(bilan.periode_debut)} → ${formatDate(bilan.periode_fin)}`,
              }),
              creer("span", {
                classe: "bilan-ligne-meta",
                texte: `Ouvert le ${formatDateHeure(bilan.date_generation)} · ${origine}`,
              }),
            ]),
            creer("span", {
              classe: "badge " + (valide ? "badge-valide" : "badge-brouillon"),
              texte: valide ? "Validé" : "Brouillon",
            }),
          ]
        ),
      ])
    );
  }
}

async function chargerBilans() {
  if (!etat.beneficiaireId) {
    etat.bilans = [];
    dessinerBilans();
    return;
  }
  try {
    etat.bilans = await api.listerBilans(etat.beneficiaireId);
  } catch (err) {
    etat.bilans = [];
    notifier(err.message, "erreur");
  }
  dessinerBilans();
}

function nomBeneficiaire() {
  const beneficiaire = etat.beneficiaireCourant;
  return beneficiaire ? `${beneficiaire.prenom} ${beneficiaire.nom}` : "Retour";
}

async function ouvrirDepuisListe(id) {
  try {
    ouvrirBilan(await api.bilan(id), nomBeneficiaire());
  } catch (err) {
    notifier(err.message, "erreur");
  }
}

// --- Barre latérale en écran étroit ---

function initBarreLaterale() {
  const barre = $("barre-laterale");
  const voile = $("voile");
  const bouton = $("menu-btn");

  const basculer = (ouvrir) => {
    barre.classList.toggle("ouverte", ouvrir);
    voile.hidden = !ouvrir;
    bouton.setAttribute("aria-expanded", ouvrir ? "true" : "false");
  };

  bouton.addEventListener("click", () => basculer(!barre.classList.contains("ouverte")));
  voile.addEventListener("click", () => basculer(false));
  sur("beneficiaire-change", () => basculer(false));

  document.addEventListener("keydown", (evenement) => {
    if (evenement.key === "Escape" && barre.classList.contains("ouverte")) {
      basculer(false);
    }
  });
}

/**
 * Fermeture de l'onglet alors que du travail n'est pas enregistré.
 *
 * Le bouton « Retour » d'un parcours demandait déjà confirmation ; fermer la
 * fenêtre, non — c'est pourtant le geste le plus fréquent, et le seul qui ne
 * pardonne pas. Le navigateur n'autorise qu'un texte générique, mais il
 * autorise l'arrêt, et c'est ce qui compte.
 *
 * Le message n'apparaît que si quelque chose est réellement en jeu : sinon
 * l'éducateur apprend à cliquer « Quitter » sans lire, et l'avertissement ne
 * vaut plus rien le jour où il compte.
 */
function initAvertissementFermeture() {
  window.addEventListener("beforeunload", (evenement) => {
    if (!parcoursModifie() && !brouillonNonEnvoye()) return;
    evenement.preventDefault();
    // Exigé par les navigateurs anciens ; les récents n'affichent que leur
    // propre formulation.
    evenement.returnValue = "";
  });
}

function initRaccourcis() {
  document.addEventListener("keydown", (evenement) => {
    const cible = evenement.target;
    const dansUnChamp =
      cible instanceof HTMLElement &&
      (cible.tagName === "INPUT" ||
        cible.tagName === "TEXTAREA" ||
        cible.tagName === "SELECT" ||
        cible.isContentEditable);

    if (evenement.key === "/" && !dansUnChamp && !document.querySelector("dialog[open]")) {
      evenement.preventDefault();
      $("recherche").focus();
    }
  });
}

// --- Démarrage ---

function signalerPanne(err) {
  $("app-alerte-texte").textContent =
    `${err.message}. Vérifiez que l'application est démarrée et que la base de données répond, ` +
    `puis rechargez la page.`;
  $("app-alerte").hidden = false;
}

/**
 * Branche l'interface, puis l'alimente avec les données déjà reçues.
 * `donnees` est le triplet rendu par `lancerAmorcage()`.
 */
function demarrer(donnees) {
  initReglages();
  initBeneficiaires();
  initRedaction();
  initBilan();
  initParcours();
  initPilotage();
  initOnglets();
  initBarreLaterale();
  initRaccourcis();
  initAvertissementFermeture();

  sur("beneficiaires-charges", majAccueil);
  sur("ouvrir-journal", ouvrirJournal);

  sur("beneficiaire-change", async (beneficiaire) => {
    arreterDicteeSiActive();

    if (!beneficiaire) {
      montrerVue("accueil");
      return;
    }

    const annees = age(beneficiaire.date_naissance);
    $("beneficiaire-nom").textContent = `${beneficiaire.prenom} ${beneficiaire.nom}`;
    $("beneficiaire-meta").textContent = [
      annees === null ? "Âge non renseigné" : `${annees} ans`,
      beneficiaire.date_naissance ? `né(e) le ${formatDate(beneficiaire.date_naissance)}` : null,
    ]
      .filter(Boolean)
      .join(" · ");

    dessinerProfil();
    restaurerBrouillon();
    montrerVue("beneficiaire");
    activerOnglet("redaction");
    // L'écran de rédaction est ouvert : le micro peut servir d'un instant à
    // l'autre, autant remettre le modèle en mémoire dès maintenant.
    planifierPreparationDictee();
    await chargerBilans();
  });

  sur("bilan-genere", async (bilan) => {
    await chargerBilans();
    ouvrirBilan(bilan, nomBeneficiaire());
  });

  sur("bilan-enregistre", chargerBilans);

  sur("parcours-ouvert", async (bilan) => {
    await chargerBilans();
    ouvrirParcours(bilan);
  });

  sur("ouvrir-bilan", async ({ bilan, relecture }) => {
    await chargerBilans();
    ouvrirBilan(bilan, nomBeneficiaire(), { relecture });
  });

  sur("retour-beneficiaire", () => {
    montrerVue("beneficiaire");
    activerOnglet("bilans");
  });

  sur("vue", montrerVue);

  const [amorce, schema, trames] = donnees;

  etat.schema = schema;
  etat.modeles = trames.modeles;
  etat.typesBilan = trames.types;

  // Le serveur fait autorité sur le rôle : il a pu changer depuis
  // l'ouverture de la session.
  etat.utilisateur = amorce.utilisateur;
  appliquerEtablissement(amorce.etablissement);
  afficherQuota(amorce.quota);
  if (amorce.equipe) {
    appliquerEquipe(amorce.equipe);
  }
  appliquerBeneficiaires(amorce.beneficiaires);

  $("suivi-btn").hidden = !estCoordinateur();
  $("suivi-btn").addEventListener("click", ouvrirTableauDeBord);
  majAccueil();
  montrerVue("accueil");
}

/**
 * Les trois appels d'ouverture, lancés ensemble. Le contenu des deux routes de
 * schéma ne change qu'entre deux versions déployées : le navigateur les
 * revalide et s'entend répondre « inchangé » en une centaine d'octets.
 */
function lancerAmorcage() {
  return Promise.all([api.amorcage(), api.schemaBilan(), api.modeles()]);
}

/**
 * Une session a-t-elle des chances d'exister ? Le serveur pose un témoin sans
 * secret à côté du cookie de session, qui lui reste inaccessible au
 * JavaScript. Ce n'est pas un contrôle — le serveur refuse de toute façon ce
 * qu'il doit refuser — mais il évite de partir chercher des données pour un
 * visiteur qui n'est manifestement pas connecté.
 */
function sessionProbable() {
  return document.cookie.split("; ").includes("session_presente=1");
}

/**
 * Séquence de démarrage.
 *
 * Quand le témoin de session est là, on demande directement les données, sans
 * commencer par « suis-je connecté ? ». Cette question coûtait un aller-retour
 * complet à chaque ouverture, alors que sa réponse est « oui » dans la
 * quasi-totalité des cas.
 *
 * La règle ne change pas pour autant : rien de l'outil n'est *obtenu* avant
 * d'être authentifié. Ce n'est pas le navigateur qui décide de s'en priver —
 * c'est le serveur qui refuse, et c'est la seule garantie qui vaille.
 */
async function amorcer() {
  let donnees = null;
  if (sessionProbable()) {
    try {
      donnees = await lancerAmorcage();
    } catch (err) {
      // 401 : la session a été fermée entre-temps. L'écran de connexion prend
      // le relais, sans que l'incident ait besoin d'être annoncé.
      if (err.statut !== 401) {
        signalerPanne(err);
        return;
      }
    }
  }

  if (!donnees) {
    let etatAuth;
    try {
      etatAuth = await api.etatAuth();
    } catch (err) {
      signalerPanne(err);
      return;
    }

    etat.utilisateur =
      etatAuth.utilisateur ||
      (await ouvrirPortail({
        initialise: etatAuth.initialise,
        etablissementExistant: etatAuth.etablissement_existant,
      }));

    try {
      donnees = await lancerAmorcage();
    } catch (err) {
      signalerPanne(err);
      return;
    }
  }

  // L'application n'est révélée qu'une fois la session établie. La masquer
  // seulement à l'écran ne suffirait pas : elle resterait dans l'ordre de
  // tabulation et dans l'arbre d'accessibilité, sous l'écran de connexion.
  $("entete").hidden = false;
  $("app").hidden = false;
  majBandeau();
  demarrer(donnees);

  // Tout ce qui se chargeait au premier clic sur le micro se charge ici.
  // L'application est déjà peinte dessous : quand la préparation est courte —
  // le cas dès le deuxième lancement — aucun écran n'apparaît, et quand elle
  // est longue, l'attente tombe avant la saisie plutôt qu'au milieu.
  preparerOutil();
}

amorcer();
