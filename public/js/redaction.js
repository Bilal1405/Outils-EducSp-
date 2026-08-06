/**
 * Onglet « Rédiger » : période, compte-rendu, dictée, génération.
 *
 * C'est l'écran de travail réel. Tout le reste de l'application existe pour y
 * amener l'éducateur dans les meilleures conditions.
 */
import { api } from "./api.js";
import { etat, emettre } from "./etat.js";
import { $, creer, notifier, statut, vider } from "./ui.js";
import { ouvrirReglages, afficherQuota, rafraichirQuota } from "./reglages.js";

/**
 * Brouillons de saisie, conservés uniquement en mémoire.
 *
 * Changer de bénéficiaire ne doit pas effacer un compte-rendu à moitié dicté.
 * Le stockage local est volontairement écarté : y écrire un compte-rendu
 * reviendrait à déposer des données de bénéficiaire sur le disque du poste,
 * hors de toute maîtrise. Fermer l'onglet efface donc tout, et c'est voulu.
 */
const brouillons = new Map();

let dictee = false;
let chronoAttente = null;
let preparationLancee = false;
/** Un téléchargement de modèle occupe-t-il la ligne d'état ? */
let preparationAffichee = false;

// --- Période ---

function isoLocal(date) {
  const mois = String(date.getMonth() + 1).padStart(2, "0");
  const jour = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${mois}-${jour}`;
}

function moisCourt(date) {
  return date.toLocaleDateString("fr-FR", { month: "short" }).replace(".", "");
}

/**
 * Raccourcis de période. Les bilans PCPE sont trimestriels : ressaisir deux
 * dates à chaque fois est un péage inutile.
 */
function periodesProposees(aujourdhui = new Date()) {
  const trimestre = (reference) => {
    const index = Math.floor(reference.getMonth() / 3);
    return {
      debut: new Date(reference.getFullYear(), index * 3, 1),
      fin: new Date(reference.getFullYear(), index * 3 + 3, 0),
    };
  };

  const courant = trimestre(aujourdhui);
  const precedent = trimestre(new Date(aujourdhui.getFullYear(), aujourdhui.getMonth() - 3, 1));

  const anneeDebut =
    aujourdhui.getMonth() >= 8 ? aujourdhui.getFullYear() : aujourdhui.getFullYear() - 1;
  const scolaire = {
    debut: new Date(anneeDebut, 8, 1),
    fin: new Date(anneeDebut + 1, 7, 31),
  };

  return [
    { cle: "courant", nom: "Trimestre en cours", ...courant },
    { cle: "precedent", nom: "Trimestre précédent", ...precedent },
    { cle: "scolaire", nom: `Année scolaire ${anneeDebut}–${anneeDebut + 1}`, ...scolaire },
  ];
}

function dessinerRaccourcis() {
  const conteneur = $("periode-raccourcis");
  vider(conteneur);

  for (const periode of periodesProposees()) {
    const debut = isoLocal(periode.debut);
    const fin = isoLocal(periode.fin);
    const detail =
      periode.cle === "scolaire"
        ? ""
        : ` · ${moisCourt(periode.debut)} – ${moisCourt(periode.fin)}`;

    conteneur.append(
      creer("button", {
        classe: "puce",
        texte: periode.nom + detail,
        attrs: { type: "button", "data-debut": debut, "data-fin": fin },
        sur: {
          click: () => {
            $("periode-debut").value = debut;
            $("periode-fin").value = fin;
            marquerRaccourciActif();
            memoriserBrouillon();
          },
        },
      })
    );
  }
}

/** Met en évidence le raccourci qui correspond exactement aux dates saisies. */
function marquerRaccourciActif() {
  const debut = $("periode-debut").value;
  const fin = $("periode-fin").value;
  for (const puce of $("periode-raccourcis").children) {
    puce.classList.toggle(
      "active",
      Boolean(debut) && puce.dataset.debut === debut && puce.dataset.fin === fin
    );
  }
}

// --- Brouillon par bénéficiaire ---

function memoriserBrouillon() {
  if (!etat.beneficiaireId) return;
  brouillons.set(etat.beneficiaireId, {
    texte: $("saisie").value,
    debut: $("periode-debut").value,
    fin: $("periode-fin").value,
    dictee,
  });
}

export function restaurerBrouillon() {
  const brouillon = brouillons.get(etat.beneficiaireId) || {
    texte: "",
    debut: "",
    fin: "",
    dictee: false,
  };
  $("saisie").value = brouillon.texte;
  $("periode-debut").value = brouillon.debut;
  $("periode-fin").value = brouillon.fin;
  dictee = brouillon.dictee;

  marquerRaccourciActif();
  majCompteur();
  statut($("redaction-statut"), "");
  // Un téléchargement de modèle en cours garde la main sur la ligne d'état :
  // changer de bénéficiaire ne doit pas faire disparaître l'avancement.
  if (!preparationAffichee) {
    $("micro-statut").textContent = "";
  }
  $("generation-encours").hidden = true;
}

function majCompteur() {
  const texte = $("saisie").value.trim();
  const mots = texte ? texte.split(/\s+/).length : 0;
  $("saisie-compteur").textContent = mots === 0 ? "" : `${mots} mot${mots > 1 ? "s" : ""}`;
}

// --- Génération ---

function demarrerAttente() {
  const debut = Date.now();
  const detail = $("generation-attente-detail");
  $("generation-encours").hidden = false;
  detail.textContent = "Cela prend généralement une dizaine de secondes.";

  chronoAttente = setInterval(() => {
    const secondes = Math.round((Date.now() - debut) / 1000);
    detail.textContent =
      secondes > 40
        ? `${secondes} s — c'est plus long que d'habitude, la génération est toujours en cours.`
        : `${secondes} s écoulées.`;
  }, 1000);
}

function arreterAttente() {
  clearInterval(chronoAttente);
  chronoAttente = null;
  $("generation-encours").hidden = true;
}

/**
 * Contrôles préalables. Chaque refus désigne l'élément à corriger et y place
 * le curseur : un message sans destination oblige l'utilisateur à chercher.
 */
function verifierPrerequis() {
  const retour = $("redaction-statut");

  if (!etat.auteurId) {
    statut(retour, "Aucun éducateur sélectionné : le bilan doit être signé.", "erreur");
    ouvrirReglages("educateur");
    return null;
  }

  const texte = $("saisie").value.trim();
  if (!texte) {
    statut(retour, "Le compte-rendu est vide : écrivez ou dictez la période.", "erreur");
    $("saisie").focus();
    return null;
  }

  const debut = $("periode-debut").value;
  const fin = $("periode-fin").value;
  if (!debut || !fin) {
    statut(retour, "Indiquez la période couverte par le bilan.", "erreur");
    (debut ? $("periode-fin") : $("periode-debut")).focus();
    return null;
  }
  if (debut > fin) {
    statut(retour, "La date de fin précède la date de début.", "erreur");
    $("periode-fin").focus();
    return null;
  }

  if (etat.quota && etat.quota.restant <= 0) {
    statut(
      retour,
      "Quota mensuel épuisé pour cet établissement : aucune génération n'est possible ce mois-ci.",
      "erreur"
    );
    return null;
  }

  return { texte, debut, fin };
}

async function generer() {
  if (!etat.beneficiaireId) return;

  const donnees = verifierPrerequis();
  if (!donnees) return;

  const bouton = $("generer-btn");
  const source = dictee ? "audio" : "texte";
  bouton.disabled = true;
  statut($("redaction-statut"), "");
  demarrerAttente();

  try {
    const resultat = await api.genererBilan(etat.beneficiaireId, etat.auteurId, {
      texte: donnees.texte,
      source,
      periode_debut: donnees.debut,
      periode_fin: donnees.fin,
    });

    if (resultat.quota) {
      afficherQuota(resultat.quota);
    }

    // Le compte-rendu a produit son bilan : le brouillon n'a plus lieu d'être.
    brouillons.delete(etat.beneficiaireId);
    dictee = false;

    notifier("Bilan rédigé. Relisez-le avant de le valider.", "ok");
    emettre("bilan-genere", {
      id: resultat.id,
      statut: resultat.statut,
      contenu: resultat.contenu,
      periode_debut: donnees.debut,
      periode_fin: donnees.fin,
      source,
    });
  } catch (err) {
    statut($("redaction-statut"), err.message, "erreur");
    notifier(err.message, "erreur");
    // Un refus peut venir du quota : on relit l'état réel plutôt que de
    // laisser un compteur périmé à l'écran.
    rafraichirQuota();
  } finally {
    arreterAttente();
    bouton.disabled = false;
  }
}

// --- Dictée ---

let enregistreur = null;
let flux = null;
let morceaux = [];

function majBoutonMicro(enCours) {
  const bouton = $("micro-btn");
  bouton.classList.toggle("enregistre", enCours);
  $("micro-libelle").textContent = enCours ? "Arrêter" : "Dicter";
  $("micro-icone").querySelector("use").setAttribute("href", enCours ? "#ico-stop" : "#ico-micro");
}

export function arreterDicteeSiActive() {
  if (enregistreur && enregistreur.state !== "inactive") {
    enregistreur.stop();
  }
}

function majProgression(pourcentage) {
  const barre = $("micro-progression");
  if (pourcentage === undefined || pourcentage === null) {
    barre.hidden = true;
    return;
  }
  barre.hidden = false;
  $("micro-progression-barre").style.width = `${Math.max(0, Math.min(100, pourcentage))}%`;
}

/**
 * Prépare le modèle de dictée en avance de phase.
 *
 * Une première dictée coûte deux choses : le téléchargement des poids — une
 * fois par poste, ensuite servi par le cache du navigateur — et l'instanciation
 * du graphe, quelques secondes à chaque onglet. Rien n'oblige à payer cela
 * après le clic sur « Arrêter », au moment précis où l'éducateur attend son
 * texte. On s'y prend donc plus tôt, à trois occasions : survol du bouton,
 * démarrage de l'enregistrement (pendant que la personne parle), et ouverture
 * de l'écran de rédaction quand le modèle est déjà en cache.
 *
 * Un téléchargement réel est toujours annoncé : engager plusieurs dizaines de
 * mégaoctets en silence n'est pas acceptable.
 */
async function preparerDictee() {
  if (preparationLancee) return;
  preparationLancee = true;

  try {
    const module = await import("/transcription.js");
    if (module.modelePret()) return;

    await module.prechargerModele((etape, pourcentage) => {
      preparationAffichee = true;
      $("micro-statut").textContent = etape;
      majProgression(pourcentage);
    });
    majProgression(null);
    if (preparationAffichee) {
      preparationAffichee = false;
      $("micro-statut").textContent = module.modelePret() ? "Dictée prête." : "";
    }
  } catch {
    // Nouvelle tentative permise au prochain déclencheur.
    preparationLancee = false;
  }
}

/**
 * Préparation automatique à l'ouverture de l'écran de rédaction, uniquement si
 * le modèle a déjà été chargé sur ce poste : il est alors dans le cache, la
 * remise en mémoire ne consomme aucun réseau. Sinon on attend un geste
 * explicite — personne ne doit déclencher un gros téléchargement sans le
 * vouloir.
 */
export function planifierPreparationDictee() {
  if (preparationLancee) return;
  if (navigator.connection && navigator.connection.saveData) return;

  const lancer = () => {
    import("/transcription.js")
      .then((module) => {
        if (module.modeleDejaCharge()) {
          preparerDictee();
        }
      })
      .catch(() => {});
  };

  if ("requestIdleCallback" in window) {
    requestIdleCallback(lancer, { timeout: 8000 });
  } else {
    setTimeout(lancer, 3000);
  }
}

async function transcrire(blob) {
  const bouton = $("micro-btn");
  bouton.disabled = true;
  try {
    const module = await import("/transcription.js");

    if (!module.modelePret()) {
      $("micro-statut").textContent = module.chargementEnCours()
        ? "Préparation de la dictée en cours…"
        : "Premier usage : téléchargement du modèle de dictée (une seule fois).";
    }

    const texte = await module.transcrire(blob, (etape, pourcentage) => {
      $("micro-statut").textContent = etape;
      majProgression(pourcentage);
    });

    const separateur = $("saisie").value.trim() ? "\n\n" : "";
    $("saisie").value += separateur + texte;
    dictee = true;
    memoriserBrouillon();
    majCompteur();
    $("micro-statut").textContent = "Transcription ajoutée — relisez-la avant de générer.";
  } catch (err) {
    $("micro-statut").textContent = "";
    statut($("redaction-statut"), `La dictée a échoué : ${err.message}`, "erreur");
    notifier("La dictée a échoué.", "erreur");
  } finally {
    majProgression(null);
    bouton.disabled = false;
  }
}

async function basculerDictee() {
  if (enregistreur && enregistreur.state === "recording") {
    enregistreur.stop();
    return;
  }

  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    statut(
      $("redaction-statut"),
      "Ce navigateur ne permet pas l'enregistrement audio.",
      "erreur"
    );
    return;
  }

  try {
    flux = await navigator.mediaDevices.getUserMedia({ audio: true });
  } catch {
    statut(
      $("redaction-statut"),
      "Accès au micro refusé. Autorisez-le dans les réglages du navigateur.",
      "erreur"
    );
    return;
  }

  const format = ["audio/webm", "audio/ogg", "audio/mp4"].find(
    (type) => window.MediaRecorder && MediaRecorder.isTypeSupported(type)
  );

  enregistreur = new MediaRecorder(flux, format ? { mimeType: format } : undefined);
  morceaux = [];

  enregistreur.addEventListener("dataavailable", (evenement) => {
    if (evenement.data.size > 0) {
      morceaux.push(evenement.data);
    }
  });

  enregistreur.addEventListener("stop", async () => {
    majBoutonMicro(false);
    flux.getTracks().forEach((piste) => piste.stop());
    flux = null;

    if (morceaux.length === 0) {
      $("micro-statut").textContent = "";
      return;
    }
    const blob = new Blob(morceaux, { type: enregistreur.mimeType || "audio/webm" });
    morceaux = [];
    await transcrire(blob);
  });

  enregistreur.start();
  majBoutonMicro(true);
  statut($("redaction-statut"), "");
  $("micro-statut").textContent = "Enregistrement… parlez normalement.";

  // Le modèle se charge pendant que la personne parle : à l'arrêt, il n'y a
  // plus qu'à transcrire.
  preparerDictee();
}

// --- Initialisation ---

export function initRedaction() {
  dessinerRaccourcis();

  $("saisie").addEventListener("input", () => {
    majCompteur();
    memoriserBrouillon();
  });

  for (const identifiant of ["periode-debut", "periode-fin"]) {
    $(identifiant).addEventListener("change", () => {
      marquerRaccourciActif();
      memoriserBrouillon();
    });
  }

  $("generer-btn").addEventListener("click", generer);
  $("micro-btn").addEventListener("click", basculerDictee);

  // Approcher le bouton suffit à déclencher la préparation : le temps de viser
  // et de cliquer est déjà pris sur l'attente.
  $("micro-btn").addEventListener("pointerenter", preparerDictee);
  $("micro-btn").addEventListener("focus", preparerDictee);

  // Ctrl/⌘ + Entrée depuis la zone de saisie : lancer la génération sans
  // quitter le clavier.
  $("saisie").addEventListener("keydown", (evenement) => {
    if ((evenement.ctrlKey || evenement.metaKey) && evenement.key === "Enter") {
      evenement.preventDefault();
      generer();
    }
  });
}
