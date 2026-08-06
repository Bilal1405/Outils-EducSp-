/**
 * État partagé et bus d'événements.
 *
 * Les modules de vue ne s'importent pas entre eux : ils publient et écoutent
 * des événements. Sans cela, « la rédaction ouvre un bilan » et « le bilan
 * rafraîchit la liste » créeraient un cycle d'imports.
 */

export const etat = {
  /** Listes fermées du schéma, chargées une fois au démarrage. */
  schema: null,

  etablissements: [],
  etablissementId: null,
  quota: null,

  utilisateurs: [],
  auteurId: null,

  beneficiaires: [],
  beneficiaireId: null,
  beneficiaireCourant: null,
  filtre: "",

  bilans: [],
  /** Bilan ouvert en relecture, et sa copie de travail. */
  bilanCourant: null,
  contenuEdite: null,
  modifie: false,
};

const abonnes = new Map();

export function sur(nom, gestionnaire) {
  if (!abonnes.has(nom)) {
    abonnes.set(nom, new Set());
  }
  abonnes.get(nom).add(gestionnaire);
}

export function emettre(nom, charge) {
  for (const gestionnaire of abonnes.get(nom) || []) {
    gestionnaire(charge);
  }
}

// --- Préférences locales ---
//
// Établissement et éducateur courants sont mémorisés d'une session à l'autre :
// ils ne changent quasiment jamais pour un même poste.

const CLES = { etablissement: "etablissementId", auteur: "auteurId" };

export function lirePreference(cle) {
  try {
    return localStorage.getItem(CLES[cle]);
  } catch {
    return null;
  }
}

export function ecrirePreference(cle, valeur) {
  try {
    if (valeur) {
      localStorage.setItem(CLES[cle], valeur);
    } else {
      localStorage.removeItem(CLES[cle]);
    }
  } catch {
    /* Navigation privée, stockage refusé : sans effet, jamais bloquant. */
  }
}

export function etablissementCourant() {
  return etat.etablissements.find((e) => e.id === etat.etablissementId) || null;
}

export function auteurCourant() {
  return etat.utilisateurs.find((u) => u.id === etat.auteurId) || null;
}
