/**
 * Établissement et éducateur : sélection, création, quota.
 *
 * Ces deux réglages conditionnent tout le reste (les bénéficiaires appartiennent
 * à un établissement, les bilans sont signés par un éducateur) mais ne changent
 * presque jamais. Ils vivent donc dans un tiroir, pas dans le flux de travail —
 * seule leur synthèse reste affichée en permanence, en tête de page.
 */
import { api } from "./api.js";
import {
  etat,
  emettre,
  ecrirePreference,
  lirePreference,
  etablissementCourant,
  auteurCourant,
} from "./etat.js";
import { $, creer, vider, notifier, statut, initiales } from "./ui.js";

/** En dessous de ce reste, le quota passe en alerte visuelle. */
const SEUIL_QUOTA_BAS = 0.2;

export function ouvrirReglages(section) {
  const tiroir = $("reglages");
  tiroir.showModal();

  if (!section) return;
  const cible = tiroir.querySelector(`[data-section="${section}"]`);
  if (!cible) return;
  cible.classList.remove("surlignee");
  // Relance de l'animation : sans ce cycle, un second appel ne rejoue rien.
  void cible.offsetWidth;
  cible.classList.add("surlignee");
  const details = cible.querySelector("details");
  if (details && !cible.querySelector("select").value) {
    details.open = true;
  }
  cible.scrollIntoView({ block: "nearest" });
}

// --- Bandeau d'identité ---

function majBandeau() {
  const etablissement = etablissementCourant();
  const auteur = auteurCourant();

  $("identite-nom").textContent = auteur
    ? `${auteur.prenom} ${auteur.nom}`
    : "Éducateur non défini";
  $("identite-etablissement").textContent = etablissement
    ? etablissement.nom
    : "Aucun établissement";
  $("identite-initiales").textContent = auteur
    ? initiales(auteur.prenom, auteur.nom)
    : "–";
}

/**
 * Le quota reste visible en permanence : c'est une limite contractuelle, la
 * découvrir au moment du refus de génération serait tardif.
 */
export function afficherQuota(quota) {
  etat.quota = quota || null;
  const bloc = $("quota");

  if (!quota) {
    bloc.hidden = true;
    $("quota-detail").textContent = "";
    return;
  }

  const total = Number(quota.quota_mensuel) || 0;
  const restant = Math.max(0, Number(quota.restant) || 0);
  const proportion = total > 0 ? restant / total : 0;

  bloc.hidden = false;
  bloc.classList.toggle("quota-epuise", restant === 0);
  bloc.classList.toggle("quota-bas", restant > 0 && proportion <= SEUIL_QUOTA_BAS);
  $("quota-texte").textContent =
    restant === 0
      ? `Quota épuisé (0 / ${total})`
      : `${restant} bilan${restant > 1 ? "s" : ""} sur ${total} ce mois-ci`;
  $("quota-jauge-barre").style.width = `${Math.round(proportion * 100)}%`;

  $("quota-detail").textContent =
    restant === 0
      ? `Quota mensuel atteint : ${quota.bilans_generes} bilan(s) générés sur ${total}. Aucune génération n'est possible avant le mois prochain.`
      : `${quota.bilans_generes} bilan(s) générés ce mois-ci sur ${total} autorisés.`;
}

export async function rafraichirQuota() {
  if (!etat.etablissementId) {
    afficherQuota(null);
    return;
  }
  try {
    afficherQuota(await api.quota(etat.etablissementId));
  } catch {
    // Un quota indisponible ne doit pas empêcher de travailler : le serveur
    // le revérifie de toute façon avant chaque génération.
    afficherQuota(null);
  }
}

// --- Listes déroulantes ---

function remplirSelect(select, elements, libelle, vide) {
  vider(select);
  if (elements.length === 0) {
    select.append(creer("option", { texte: vide, attrs: { value: "" } }));
    select.disabled = true;
    return;
  }
  select.disabled = false;
  for (const element of elements) {
    select.append(
      creer("option", { texte: libelle(element), attrs: { value: element.id } })
    );
  }
}

export async function chargerEtablissements(selectionner) {
  etat.etablissements = await api.listerEtablissements();

  const souhaite =
    selectionner || etat.etablissementId || lirePreference("etablissement");
  const existe = etat.etablissements.some((e) => e.id === souhaite);
  etat.etablissementId = existe
    ? souhaite
    : etat.etablissements[0]?.id || null;

  remplirSelect(
    $("etablissement-select"),
    etat.etablissements,
    (e) => e.nom,
    "Aucun établissement enregistré"
  );
  $("etablissement-select").value = etat.etablissementId || "";
  ecrirePreference("etablissement", etat.etablissementId);

  majBandeau();
  await rafraichirQuota();
}

export async function chargerUtilisateurs(selectionner) {
  etat.utilisateurs = await api.listerUtilisateurs();

  const souhaite = selectionner || etat.auteurId || lirePreference("auteur");
  const existe = etat.utilisateurs.some((u) => u.id === souhaite);
  etat.auteurId = existe ? souhaite : etat.utilisateurs[0]?.id || null;

  remplirSelect(
    $("auteur-select"),
    etat.utilisateurs,
    (u) => `${u.prenom} ${u.nom}`,
    "Aucun éducateur enregistré"
  );
  $("auteur-select").value = etat.auteurId || "";
  ecrirePreference("auteur", etat.auteurId);

  majBandeau();
}

// --- Création ---

async function creerEtablissement() {
  const bouton = $("etablissement-creer");
  const retour = $("etablissement-statut");
  const nom = $("etablissement-nom").value.trim();
  const quotaBrut = $("etablissement-quota").value.trim();

  if (!nom) {
    statut(retour, "Indiquez le nom de l'établissement.", "erreur");
    $("etablissement-nom").focus();
    return;
  }

  const corps = { nom };
  if (quotaBrut) {
    const quota = Number(quotaBrut);
    if (!Number.isInteger(quota) || quota < 1) {
      statut(retour, "Le quota doit être un nombre entier d'au moins 1.", "erreur");
      $("etablissement-quota").focus();
      return;
    }
    corps.quota_mensuel_bilans = quota;
  }

  bouton.disabled = true;
  statut(retour, "Création en cours…");
  try {
    const cree = await api.creerEtablissement(corps);
    await chargerEtablissements(cree.id);
    $("etablissement-nom").value = "";
    $("etablissement-quota").value = "";
    statut(retour, "");
    $("etablissement-ajout").open = false;
    notifier(`Établissement « ${nom} » ajouté.`, "ok");
    emettre("etablissement-change");
  } catch (err) {
    statut(retour, err.message, "erreur");
  } finally {
    bouton.disabled = false;
  }
}

async function creerUtilisateur() {
  const bouton = $("auteur-creer");
  const retour = $("auteur-statut");
  const prenom = $("auteur-prenom").value.trim();
  const nom = $("auteur-nom").value.trim();
  const email = $("auteur-email").value.trim();

  if (!prenom || !nom || !email) {
    statut(retour, "Prénom, nom et adresse électronique sont requis.", "erreur");
    return;
  }

  bouton.disabled = true;
  statut(retour, "Création en cours…");
  try {
    const cree = await api.creerUtilisateur({ nom, prenom, email });
    await chargerUtilisateurs(cree.id);
    $("auteur-prenom").value = "";
    $("auteur-nom").value = "";
    $("auteur-email").value = "";
    statut(retour, "");
    $("educateur-ajout").open = false;
    notifier(`${prenom} ${nom} ajouté.`, "ok");
    emettre("auteur-change");
  } catch (err) {
    statut(retour, err.message, "erreur");
  } finally {
    bouton.disabled = false;
  }
}

export function initReglages() {
  $("reglages-btn").addEventListener("click", () => ouvrirReglages());
  $("reglages-fermer").addEventListener("click", () => $("reglages").close());

  // Clic sur le fond du tiroir : ferme, comme le ferait Échap.
  $("reglages").addEventListener("click", (evenement) => {
    if (evenement.target === $("reglages")) {
      $("reglages").close();
    }
  });

  $("etablissement-select").addEventListener("change", async (evenement) => {
    etat.etablissementId = evenement.target.value || null;
    ecrirePreference("etablissement", etat.etablissementId);
    majBandeau();
    await rafraichirQuota();
    emettre("etablissement-change");
  });

  $("auteur-select").addEventListener("change", (evenement) => {
    etat.auteurId = evenement.target.value || null;
    ecrirePreference("auteur", etat.auteurId);
    majBandeau();
    emettre("auteur-change");
  });

  $("etablissement-creer").addEventListener("click", creerEtablissement);
  $("auteur-creer").addEventListener("click", creerUtilisateur);

  // Entrée dans un champ du tiroir vaut validation du formulaire concerné.
  for (const [champs, action] of [
    [["etablissement-nom", "etablissement-quota"], creerEtablissement],
    [["auteur-prenom", "auteur-nom", "auteur-email"], creerUtilisateur],
  ]) {
    for (const identifiant of champs) {
      $(identifiant).addEventListener("keydown", (evenement) => {
        if (evenement.key === "Enter") {
          evenement.preventDefault();
          action();
        }
      });
    }
  }

  for (const bouton of document.querySelectorAll("[data-ouvrir-reglages]")) {
    bouton.addEventListener("click", () =>
      ouvrirReglages(bouton.dataset.ouvrirReglages)
    );
  }
}
