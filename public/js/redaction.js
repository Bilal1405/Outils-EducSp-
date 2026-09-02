/**
 * Onglet « Rédiger » : période, compte-rendu, dictée, génération.
 *
 * C'est l'écran de travail réel. Tout le reste de l'application existe pour y
 * amener l'éducateur dans les meilleures conditions.
 */
import { api } from "./api.js";
import { etat, emettre } from "./etat.js";
import * as dictee from "./dictee.js";
import { $, creer, formatDate, notifier, statut, vider } from "./ui.js";
import { afficherQuota, rafraichirQuota } from "./reglages.js";

/**
 * Brouillons de saisie, en mémoire de l'onglet et sur le serveur.
 *
 * Le stockage du navigateur reste écarté : y écrire un compte-rendu déposerait
 * des données de bénéficiaire sur le disque du poste, hors de toute maîtrise.
 * Mais s'en tenir à la mémoire de l'onglet avait une conséquence qui, elle,
 * n'était pas assumée : un rechargement ou une fermeture accidentelle effaçait
 * dix minutes de dictée relue, et on ne re-dicte pas ce qu'on a dit.
 *
 * Le brouillon part donc au serveur, où il est cloisonné par établissement,
 * réservé à son rédacteur et effacé avec le bénéficiaire — comme le reste. La
 * mémoire locale demeure en première ligne : elle est à jour à la frappe près
 * et fait tenir le changement de fiche sans aller-retour.
 */
const brouillons = new Map();

let dicteeUtilisee = false;
let chronoAttente = null;
/** Envoi différé du brouillon au serveur (cf. `planifierEnvoiBrouillon`). */
let chronoBrouillon = null;
/** Dernier état effectivement accepté par le serveur, pour ne pas le réécrire. */
let derniereEmpreinteEnvoyee = null;
/** Un envoi a-t-il échoué, laissant de la saisie non enregistrée ? */
let brouillonEnAttente = false;
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
    dictee: dicteeUtilisee,
  });
  planifierEnvoiBrouillon(etat.beneficiaireId);
}

/**
 * Envoi différé du brouillon au serveur.
 *
 * Deux secondes après la dernière frappe : assez court pour qu'une fermeture
 * accidentelle ne coûte qu'une phrase, assez long pour ne pas produire une
 * requête par caractère. L'identifiant du bénéficiaire est figé au moment de
 * la planification — sans quoi un changement de fiche pendant le délai
 * écrirait le texte de l'un sur le brouillon de l'autre.
 */
function planifierEnvoiBrouillon(beneficiaireId) {
  clearTimeout(chronoBrouillon);
  chronoBrouillon = setTimeout(() => envoyerBrouillon(beneficiaireId), 2000);
}

async function envoyerBrouillon(beneficiaireId) {
  const brouillon = brouillons.get(beneficiaireId);
  if (!brouillon) return;

  const empreinte = JSON.stringify(brouillon);
  if (empreinte === derniereEmpreinteEnvoyee) return;

  try {
    await api.enregistrerBrouillon(beneficiaireId, {
      texte: brouillon.texte,
      periode_debut: brouillon.debut || null,
      periode_fin: brouillon.fin || null,
      source_dictee: brouillon.dictee,
    });
    derniereEmpreinteEnvoyee = empreinte;
    brouillonEnAttente = false;
  } catch {
    // Le texte reste à l'écran et en mémoire : rien n'est perdu tant que
    // l'onglet vit. C'est `avantFermeture` qui préviendra si la personne
    // ferme avant que le réseau soit revenu.
    brouillonEnAttente = true;
  }
}

/** Reste-t-il de la saisie que le serveur n'a pas reçue ? */
export function brouillonNonEnvoye() {
  const brouillon = brouillons.get(etat.beneficiaireId);
  if (!brouillon || brouillon.texte.trim() === "") return false;
  return brouillonEnAttente || JSON.stringify(brouillon) !== derniereEmpreinteEnvoyee;
}

/**
 * Restaure ce qui était en cours pour ce bénéficiaire.
 *
 * La mémoire de l'onglet d'abord — elle est à jour à la frappe près — puis le
 * serveur, qui seul survit à un rechargement ou à un changement de poste.
 */
export async function restaurerBrouillon() {
  const beneficiaireId = etat.beneficiaireId;
  const enMemoire = brouillons.get(beneficiaireId);

  // L'écran est repeint tout de suite, avec ce qu'on a. Attendre le serveur
  // laisserait à l'affichage, le temps d'un aller-retour, le compte-rendu du
  // bénéficiaire précédent : c'est le genre de confusion qu'on ne rattrape pas.
  afficherBrouillon(enMemoire);

  if (enMemoire || !beneficiaireId) return;

  let enregistre = null;
  try {
    enregistre = await api.brouillon(beneficiaireId);
  } catch {
    // Brouillon indisponible : la saisie reste vierge plutôt que de bloquer
    // l'écran. Rien n'est écrasé — l'enregistrement ne part qu'à la première
    // frappe.
    return;
  }

  // La personne a pu changer de fiche, ou commencer à écrire, pendant l'appel.
  if (etat.beneficiaireId !== beneficiaireId || !enregistre) return;
  if ($("saisie").value.trim() !== "") return;

  const brouillon = {
    texte: enregistre.texte,
    debut: enregistre.periode_debut || "",
    fin: enregistre.periode_fin || "",
    dictee: enregistre.source_dictee,
  };
  brouillons.set(beneficiaireId, brouillon);
  derniereEmpreinteEnvoyee = JSON.stringify(brouillon);
  afficherBrouillon(brouillon);
  statut(
    $("redaction-statut"),
    "Compte-rendu en cours repris là où vous l'aviez laissé."
  );
}

/** Peint la zone de rédaction à partir d'un brouillon, ou à vide. */
function afficherBrouillon(brouillon) {
  const valeurs = brouillon || { texte: "", debut: "", fin: "", dictee: false };
  $("saisie").value = valeurs.texte;
  $("periode-debut").value = valeurs.debut;
  $("periode-fin").value = valeurs.fin;
  dicteeUtilisee = valeurs.dictee;

  marquerRaccourciActif();
  majCompteur();
  statut($("redaction-statut"), "");
  // Un téléchargement de modèle en cours garde la main sur la ligne d'état :
  // changer de bénéficiaire ne doit pas faire disparaître l'avancement.
  if (!preparationAffichee) {
    $("micro-statut").textContent = "";
  }
  $("generation-encours").hidden = true;
  dessinerTypes();
  appliquerType();
}

function majCompteur() {
  const texte = $("saisie").value.trim();
  const mots = texte ? texte.split(/\s+/).length : 0;
  $("saisie-compteur").textContent = mots === 0 ? "" : `${mots} mot${mots > 1 ? "s" : ""}`;
}

// --- Choix de la trame ---

/**
 * Trois trames coexistent. « Bilan » passe par le moteur à partir d'un
 * compte-rendu libre ; les deux autres reprennent un document existant et se
 * remplissent dans un parcours guidé. Le choix se fait donc avant tout le
 * reste, puisqu'il change l'écran.
 */
function dessinerTypes() {
  const conteneur = $("types-bilan");
  vider(conteneur);

  for (const { type, libelle } of etat.typesBilan) {
    const actif = etat.typeChoisi === type;
    conteneur.append(
      creer(
        "button",
        {
          classe: "type-bilan" + (actif ? " actif" : ""),
          attrs: {
            type: "button",
            role: "radio",
            "aria-checked": actif ? "true" : "false",
          },
          sur: { click: () => choisirType(type) },
        },
        [
          creer("span", { classe: "type-bilan-nom", texte: libelle }),
          creer("span", {
            classe: "type-bilan-detail",
            texte:
              type === "bilan"
                ? "Rédigé par le moteur à partir de votre compte-rendu."
                : "Grille à remplir, étape par étape.",
          }),
        ]
      )
    );
  }
}

function choisirType(type) {
  etat.typeChoisi = type;
  dessinerTypes();
  appliquerType();
}

function appliquerType() {
  const guide = etat.typeChoisi !== "bilan";
  $("bloc-redaction-libre").hidden = guide;
  $("generation-encours").hidden = true;
  $("bloc-guide").hidden = !guide;

  if (!guide) return;

  const modele = etat.modeles && etat.modeles[etat.typeChoisi];
  const nombreEtapes = modele ? modele.etapes.length : 0;
  $("guide-titre").textContent = modele ? modele.nom : "";
  $("guide-aide").textContent = modele
    ? `Ce bilan reprend le document existant : ${nombreEtapes} étapes, une par écran. ` +
      "Les grilles se cochent à la main, les commentaires se dictent ou se tapent " +
      "et peuvent être remis au propre par le moteur. Vous pouvez interrompre et reprendre à tout moment."
    : "";
  statut($("guide-statut"), "");
  proposerReprise();
}

/**
 * Reprise du bilan précédent.
 *
 * D'un trimestre à l'autre, une grille bouge peu : recoter soixante lignes
 * identiques n'apporte rien. Mais une cotation reprise date d'une autre
 * période — le parcours la signale comme telle tant qu'elle n'a pas été
 * revue, et l'option est décochée par défaut. Repartir de zéro reste le
 * comportement normal ; reprendre est un choix explicite.
 */
async function proposerReprise() {
  const choix = $("reprise-choix");
  choix.hidden = true;
  $("reprise-case").checked = false;
  if (etat.typeChoisi === "bilan" || !etat.beneficiaireId) return;

  try {
    const precedent = await api.bilanPrecedent(etat.beneficiaireId, etat.typeChoisi);
    if (!precedent) return;
    $("reprise-libelle").textContent =
      `Repartir du bilan validé du ${formatDate(precedent.periode_fin)} ` +
      "(les valeurs reprises seront signalées à relire)";
    choix.hidden = false;
  } catch {
    // Pas de reprise proposée : on ouvre un bilan vierge, ce qui est le
    // comportement par défaut de toute façon.
  }
}

async function ouvrirBilanGuide() {
  const retour = $("guide-statut");

  const debut = $("periode-debut").value;
  const fin = $("periode-fin").value;
  if (!debut || !fin) {
    statut(retour, "Indiquez la période couverte par le bilan.", "erreur");
    (debut ? $("periode-fin") : $("periode-debut")).focus();
    return;
  }
  if (debut > fin) {
    statut(retour, "La date de fin précède la date de début.", "erreur");
    $("periode-fin").focus();
    return;
  }
  if (etat.quota && etat.quota.restant <= 0) {
    statut(
      retour,
      "Quota mensuel épuisé pour cet établissement : aucun bilan ne peut être ouvert ce mois-ci.",
      "erreur"
    );
    return;
  }

  const bouton = $("ouvrir-parcours-btn");
  bouton.disabled = true;
  statut(retour, "Ouverture du bilan…");

  try {
    const bilan = await api.ouvrirBilanGuide(etat.beneficiaireId, {
      type: etat.typeChoisi,
      periode_debut: debut,
      periode_fin: fin,
      reprendre_precedent: $("reprise-case").checked,
    });
    if (bilan.quota) {
      afficherQuota(bilan.quota);
    }
    statut(retour, "");
    emettre("parcours-ouvert", bilan);
  } catch (err) {
    statut(retour, err.message, "erreur");
    notifier(err.message, "erreur");
    rafraichirQuota();
  } finally {
    bouton.disabled = false;
  }
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
  const source = dicteeUtilisee ? "audio" : "texte";
  bouton.disabled = true;
  statut($("redaction-statut"), "");
  demarrerAttente();

  try {
    const resultat = await api.genererBilan(etat.beneficiaireId, {
      texte: donnees.texte,
      source,
      periode_debut: donnees.debut,
      periode_fin: donnees.fin,
    });

    if (resultat.quota) {
      afficherQuota(resultat.quota);
    }

    // Le compte-rendu a produit son bilan : le brouillon n'a plus lieu d'être,
    // ni en mémoire ni en base — c'est une donnée de santé qu'on ne garde pas
    // sans raison. L'envoi différé encore en attente est annulé, sans quoi il
    // recréerait ce qu'on vient d'effacer.
    clearTimeout(chronoBrouillon);
    brouillons.delete(etat.beneficiaireId);
    derniereEmpreinteEnvoyee = null;
    brouillonEnAttente = false;
    dicteeUtilisee = false;
    api.supprimerBrouillon(etat.beneficiaireId).catch(() => {
      /* Le bilan est enregistré : un brouillon résiduel ne doit pas alarmer. */
    });

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

function majBoutonMicro(enCours) {
  const bouton = $("micro-btn");
  bouton.classList.toggle("enregistre", enCours);
  $("micro-libelle").textContent = enCours ? "Arrêter" : "Dicter";
  $("micro-icone")
    .querySelector("use")
    .setAttribute("href", enCours ? "#ico-stop" : "#ico-micro");
}

export function arreterDicteeSiActive() {
  dictee.arreter();
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

export function planifierPreparationDictee() {
  dictee.planifierPreparation();
}

function basculerDictee() {
  dictee.basculer({
    onEtat: (phase, message, pourcentage) => {
      majBoutonMicro(phase === "enregistrement");
      majProgression(pourcentage);
      if (phase === "erreur") {
        statut($("redaction-statut"), message, "erreur");
        $("micro-statut").textContent = "";
        preparationAffichee = false;
        return;
      }
      preparationAffichee = phase === "preparation" || phase === "transcription";
      $("micro-statut").textContent = message;
    },
    onTexte: (texte) => {
      const separateur = $("saisie").value.trim() ? "\n\n" : "";
      $("saisie").value += separateur + texte;
      dicteeUtilisee = true;
      memoriserBrouillon();
      majCompteur();
      $("micro-statut").textContent =
        "Transcription ajoutée — relisez-la avant de générer.";
      preparationAffichee = false;
    },
  });
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

  dessinerTypes();
  appliquerType();

  $("ouvrir-parcours-btn").addEventListener("click", ouvrirBilanGuide);
  $("generer-btn").addEventListener("click", generer);
  $("micro-btn").addEventListener("click", basculerDictee);

  // Approcher le bouton suffit à déclencher la préparation : le temps de viser
  // et de cliquer est déjà pris sur l'attente.
  $("micro-btn").addEventListener("pointerenter", dictee.preparer);
  $("micro-btn").addEventListener("focus", dictee.preparer);

  // Ctrl/⌘ + Entrée depuis la zone de saisie : lancer la génération sans
  // quitter le clavier.
  $("saisie").addEventListener("keydown", (evenement) => {
    if ((evenement.ctrlKey || evenement.metaKey) && evenement.key === "Enter") {
      evenement.preventDefault();
      generer();
    }
  });
}
