/**
 * Colonne des bénéficiaires : liste, recherche, création, état civil.
 *
 * Vocabulaire : l'API parle de `patients` (nom de table historique), l'interface
 * dit « bénéficiaire ». C'est le terme du secteur médico-social ; « patient »
 * relève du soin et ne correspond pas à un accompagnement PCPE.
 */
import { api } from "./api.js";
import { confirmerAbandon } from "./bilan.js";
import { etat, emettre } from "./etat.js";
import {
  $,
  age,
  creer,
  initiales,
  normaliser,
  notifier,
  statut,
  versValeurDate,
  vider,
} from "./ui.js";

function libelle(beneficiaire) {
  return `${beneficiaire.prenom} ${beneficiaire.nom}`.trim();
}

function sousTitre(beneficiaire) {
  const annees = age(beneficiaire.date_naissance);
  return annees === null ? "Âge non renseigné" : `${annees} ans`;
}

// --- Liste ---

export function dessinerListe() {
  const liste = $("liste-beneficiaires");
  vider(liste);

  if (!etat.etablissementId) {
    liste.append(
      creer("p", {
        classe: "liste-message",
        texte: "Choisissez un établissement dans les réglages pour voir ses bénéficiaires.",
      })
    );
    return;
  }

  const filtre = normaliser(etat.filtre);
  const visibles = filtre
    ? etat.beneficiaires.filter((b) => normaliser(libelle(b)).includes(filtre))
    : etat.beneficiaires;

  if (visibles.length === 0) {
    liste.append(
      creer("p", {
        classe: "liste-message",
        texte: filtre
          ? `Aucun bénéficiaire ne correspond à « ${etat.filtre} ».`
          : "Aucun bénéficiaire dans cet établissement.",
      })
    );
    return;
  }

  for (const beneficiaire of visibles) {
    liste.append(
      creer(
        "button",
        {
          classe:
            "beneficiaire" + (etat.beneficiaireId === beneficiaire.id ? " actif" : ""),
          attrs: {
            type: "button",
            "aria-current": etat.beneficiaireId === beneficiaire.id ? "true" : null,
          },
          sur: { click: () => selectionner(beneficiaire.id) },
        },
        [
          creer("span", {
            classe: "beneficiaire-initiales",
            texte: initiales(beneficiaire.prenom, beneficiaire.nom),
          }),
          creer("span", { classe: "beneficiaire-textes" }, [
            creer("span", { classe: "beneficiaire-nom", texte: libelle(beneficiaire) }),
            creer("span", { classe: "beneficiaire-meta", texte: sousTitre(beneficiaire) }),
          ]),
        ]
      )
    );
  }
}

export async function chargerBeneficiaires() {
  if (!etat.etablissementId) {
    etat.beneficiaires = [];
  } else {
    etat.beneficiaires = await api.listerBeneficiaires(etat.etablissementId);
  }

  // Le bénéficiaire ouvert peut ne plus appartenir à l'établissement courant.
  if (
    etat.beneficiaireId &&
    !etat.beneficiaires.some((b) => b.id === etat.beneficiaireId)
  ) {
    etat.beneficiaireId = null;
    etat.beneficiaireCourant = null;
    emettre("beneficiaire-change", null);
  }

  dessinerListe();
  emettre("beneficiaires-charges");
}

export function selectionner(id) {
  const beneficiaire = etat.beneficiaires.find((b) => b.id === id);
  if (!beneficiaire) return;

  // Un bilan en cours de correction ne doit pas disparaître sur un clic
  // dans la liste.
  if (!confirmerAbandon()) return;
  etat.modifie = false;

  etat.beneficiaireId = id;
  etat.beneficiaireCourant = beneficiaire;
  dessinerListe();
  emettre("beneficiaire-change", beneficiaire);
}

/** Remplit l'onglet « Fiche » à partir du bénéficiaire courant. */
export function dessinerProfil() {
  const beneficiaire = etat.beneficiaireCourant;
  if (!beneficiaire) return;
  $("profil-prenom").value = beneficiaire.prenom || "";
  $("profil-nom").value = beneficiaire.nom || "";
  $("profil-date-naissance").value = versValeurDate(beneficiaire.date_naissance);
  statut($("profil-statut"), "");
}

// --- Création ---

function ouvrirCreation() {
  const modale = $("dlg-beneficiaire");
  $("beneficiaire-form").reset();
  statut($("nouveau-statut"), "");

  const etablissement = etat.etablissements.find((e) => e.id === etat.etablissementId);
  $("nouveau-etablissement-rappel").textContent = etablissement
    ? `Rattaché à l'établissement « ${etablissement.nom} ».`
    : "Aucun établissement sélectionné : définissez-en un dans les réglages avant de continuer.";

  modale.showModal();
  $("nouveau-prenom").focus();
}

async function soumettreCreation(evenement) {
  evenement.preventDefault();
  const retour = $("nouveau-statut");
  const prenom = $("nouveau-prenom").value.trim();
  const nom = $("nouveau-nom").value.trim();
  const dateNaissance = $("nouveau-date-naissance").value || null;

  if (!etat.etablissementId) {
    statut(retour, "Sélectionnez d'abord un établissement dans les réglages.", "erreur");
    return;
  }
  if (!prenom || !nom) {
    statut(retour, "Le prénom et le nom sont requis.", "erreur");
    return;
  }

  const bouton = $("nouveau-creer");
  bouton.disabled = true;
  statut(retour, "Création en cours…");
  try {
    const cree = await api.creerBeneficiaire({
      nom,
      prenom,
      date_naissance: dateNaissance,
      etablissement_id: etat.etablissementId,
    });
    await chargerBeneficiaires();
    $("dlg-beneficiaire").close();
    notifier(`${prenom} ${nom} ajouté.`, "ok");
    selectionner(cree.id);
  } catch (err) {
    statut(retour, err.message, "erreur");
  } finally {
    bouton.disabled = false;
  }
}

async function enregistrerProfil(evenement) {
  evenement.preventDefault();
  if (!etat.beneficiaireId) return;

  const retour = $("profil-statut");
  const prenom = $("profil-prenom").value.trim();
  const nom = $("profil-nom").value.trim();
  if (!prenom || !nom) {
    statut(retour, "Le prénom et le nom sont requis.", "erreur");
    return;
  }

  const bouton = $("profil-enregistrer");
  bouton.disabled = true;
  statut(retour, "Enregistrement…");
  try {
    const modifie = await api.modifierBeneficiaire(etat.beneficiaireId, {
      nom,
      prenom,
      date_naissance: $("profil-date-naissance").value || null,
    });
    etat.beneficiaireCourant = modifie;
    await chargerBeneficiaires();
    dessinerListe();
    emettre("beneficiaire-change", modifie);
    statut(retour, "");
    notifier("Fiche mise à jour.", "ok");
  } catch (err) {
    statut(retour, err.message, "erreur");
  } finally {
    bouton.disabled = false;
  }
}

export function initBeneficiaires() {
  $("recherche").addEventListener("input", (evenement) => {
    etat.filtre = evenement.target.value;
    dessinerListe();
  });

  for (const bouton of document.querySelectorAll("[data-nouveau-beneficiaire]")) {
    bouton.addEventListener("click", ouvrirCreation);
  }
  $("beneficiaire-form").addEventListener("submit", soumettreCreation);
  $("profil-form").addEventListener("submit", enregistrerProfil);

  for (const bouton of document.querySelectorAll("[data-fermer-modale]")) {
    bouton.addEventListener("click", () => bouton.closest("dialog").close());
  }
}
