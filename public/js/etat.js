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
  /** Trames des bilans Répit et Trimestriel, publiées par le serveur. */
  modeles: null,
  typesBilan: [],
  /** Trame retenue pour le prochain bilan de ce bénéficiaire. */
  typeChoisi: "bilan",

  /** Parcours guidé en cours : bilan ouvert, étape affichée, brouillon local. */
  parcours: null,

  /** Utilisateur connecté et son établissement, établis par la session. */
  utilisateur: null,
  etablissement: null,
  quota: null,

  /** Membres de l'équipe, visibles du coordinateur seulement. */
  utilisateurs: [],

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

/** L'établissement de travail est celui de la session, jamais un choix. */
export function etablissementCourant() {
  return etat.etablissement;
}
