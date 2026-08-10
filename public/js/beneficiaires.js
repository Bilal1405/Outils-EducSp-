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
import { estCoordinateur } from "./reglages.js";
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
  appliquerBeneficiaires(await api.listerBeneficiaires());
}

/**
 * Rendu à partir d'une liste déjà reçue : l'amorçage la tient de la réponse
 * unique, il n'a pas à la redemander.
 */
export function appliquerBeneficiaires(beneficiaires) {
  etat.beneficiaires = beneficiaires;

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
  // L'effacement est réservé au coordinateur : c'est la seule action
  // irréversible de l'application.
  $("carte-effacement").hidden = !estCoordinateur();
}

/**
 * Droit à l'effacement. Double garde-fou : la confirmation rappelle ce qui
 * disparaît, et exige de saisir le nom — un « OK » réflexe ne doit pas suffire
 * à supprimer un dossier.
 */
async function supprimerBeneficiaire() {
  const beneficiaire = etat.beneficiaireCourant;
  if (!beneficiaire) return;

  const attendu = `${beneficiaire.prenom} ${beneficiaire.nom}`;
  const saisi = window.prompt(
    `Supprimer définitivement ${attendu} et tous ses bilans, y compris les bilans archivés ?\n\n` +
      `Cette action est irréversible. Pour confirmer, saisissez le nom complet :\n${attendu}`
  );
  if (saisi === null) return;
  if (saisi.trim() !== attendu) {
    notifier("Nom non conforme : suppression annulée.", "erreur");
    return;
  }

  try {
    const resultat = await api.supprimerBeneficiaire(beneficiaire.id);
    etat.beneficiaireId = null;
    etat.beneficiaireCourant = null;
    await chargerBeneficiaires();
    emettre("beneficiaire-change", null);
    notifier(
      `${attendu} et ${resultat.bilans_supprimes} bilan(s) supprimés.`,
      "ok"
    );
  } catch (err) {
    notifier(err.message, "erreur");
  }
}

// --- Création ---

function ouvrirCreation() {
  const modale = $("dlg-beneficiaire");
  $("beneficiaire-form").reset();
  statut($("nouveau-statut"), "");

  $("nouveau-etablissement-rappel").textContent = etat.etablissement
    ? `Rattaché à l'établissement « ${etat.etablissement.nom} ».`
    : "";

  modale.showModal();
  $("nouveau-prenom").focus();
}

async function soumettreCreation(evenement) {
  evenement.preventDefault();
  const retour = $("nouveau-statut");
  const prenom = $("nouveau-prenom").value.trim();
  const nom = $("nouveau-nom").value.trim();
  const dateNaissance = $("nouveau-date-naissance").value || null;

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
  $("supprimer-beneficiaire").addEventListener("click", supprimerBeneficiaire);

  for (const bouton of document.querySelectorAll("[data-fermer-modale]")) {
    bouton.addEventListener("click", () => bouton.closest("dialog").close());
  }
}
