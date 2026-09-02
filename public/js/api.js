/**
 * Accès à l'API HTTP. Point unique : aucun `fetch` ailleurs dans l'interface,
 * pour que le traitement des erreurs soit identique partout.
 */

/**
 * Recompose un message lisible à partir de la réponse d'erreur du serveur.
 * Les détails Zod sont conservés : « Requête invalide » seul n'aide personne à
 * corriger sa saisie.
 */
function messageErreur(donnees, statut) {
  if (!donnees || typeof donnees !== "object") {
    return `Le serveur a répondu ${statut}`;
  }
  let message = donnees.error || `Le serveur a répondu ${statut}`;
  const champs = donnees.details && donnees.details.fieldErrors;
  if (champs) {
    const precisions = Object.entries(champs)
      .filter(([, messages]) => Array.isArray(messages) && messages.length > 0)
      .map(([champ, messages]) => `${champ} : ${messages.join(", ")}`);
    if (precisions.length > 0) {
      message += ` — ${precisions.join(" ; ")}`;
    }
  }
  if (donnees.details && typeof donnees.details === "string") {
    message += ` — ${donnees.details}`;
  }
  return message;
}

export class ErreurApi extends Error {
  constructor(message, statut, donnees) {
    super(message);
    this.name = "ErreurApi";
    this.statut = statut;
    this.donnees = donnees;
  }
}

async function requete(url, options) {
  let reponse;
  try {
    reponse = await fetch(url, options);
  } catch (err) {
    // Serveur arrêté, coupure réseau : le message natif (« Failed to fetch »)
    // n'apprend rien à un éducateur.
    throw new ErreurApi("Le serveur ne répond pas", 0, null);
  }

  const donnees = await reponse.json().catch(() => null);
  if (!reponse.ok) {
    throw new ErreurApi(messageErreur(donnees, reponse.status), reponse.status, donnees);
  }
  return donnees;
}

/**
 * En-tête exigé par le serveur sur toute écriture.
 *
 * L'authentification repose sur un cookie : un site tiers pourrait sinon faire
 * exécuter une requête au navigateur d'un éducateur connecté. Un formulaire
 * HTML ou une image ne peuvent pas poser d'en-tête personnalisé ; seul du
 * JavaScript le peut, et il serait alors soumis au contrôle d'origine du
 * navigateur.
 */
const ENTETE_ORIGINE = "x-outils-educsp";

function envoyer(url, methode, corps) {
  return requete(url, {
    method: methode,
    headers: { "Content-Type": "application/json", [ENTETE_ORIGINE]: "1" },
    body: corps === undefined ? undefined : JSON.stringify(corps),
  });
}

export const api = {
  // --- Session ---
  etatAuth: () => requete("/api/auth/etat"),
  initialiser: (corps) => envoyer("/api/auth/initialisation", "POST", corps),
  connexion: (email, motDePasse) =>
    envoyer("/api/auth/connexion", "POST", { email, mot_de_passe: motDePasse }),
  deconnexion: () => envoyer("/api/auth/deconnexion", "POST"),
  changerMotDePasse: (actuel, nouveau) =>
    envoyer("/api/auth/mot-de-passe", "POST", {
      mot_de_passe_actuel: actuel,
      nouveau_mot_de_passe: nouveau,
    }),

  // Tout ce qu'il faut pour afficher l'application, en un aller-retour.
  amorcage: () => requete("/api/amorcage"),

  schemaBilan: () => requete("/api/schema/bilan"),
  modeles: () => requete("/api/schema/modeles"),

  reformuler: (texte, intitule) =>
    envoyer("/api/assistance/reformulation", "POST", { texte, intitule }),

  // --- Établissement ---
  etablissement: () => requete("/api/etablissement"),
  majEtablissement: (corps) => envoyer("/api/etablissement", "PATCH", corps),
  quota: () => requete("/api/etablissement/quota"),
  audit: (limite = 200) => requete(`/api/etablissement/audit?limite=${limite}`),
  tableauDeBord: () => requete("/api/tableau-de-bord"),

  listerUtilisateurs: () => requete("/api/utilisateurs"),
  creerUtilisateur: (corps) => envoyer("/api/utilisateurs", "POST", corps),
  desactiverUtilisateur: (id) =>
    envoyer(`/api/utilisateurs/${id}/desactivation`, "POST"),

  // --- Bénéficiaires ---
  // Plus de paramètre d'établissement : il vient de la session, l'appelant ne
  // le choisit plus.
  listerBeneficiaires: () => requete("/api/patients"),
  supprimerBeneficiaire: (id) => envoyer(`/api/patients/${id}`, "DELETE"),
  creerBeneficiaire: (corps) => envoyer("/api/patients", "POST", corps),
  modifierBeneficiaire: (id, corps) => envoyer(`/api/patients/${id}`, "PATCH", corps),

  // Brouillon de saisie : propre à son rédacteur, effacé dès qu'il a produit
  // son bilan.
  brouillon: (beneficiaireId) => requete(`/api/patients/${beneficiaireId}/brouillon`),
  enregistrerBrouillon: (beneficiaireId, corps) =>
    envoyer(`/api/patients/${beneficiaireId}/brouillon`, "PUT", corps),
  supprimerBrouillon: (beneficiaireId) =>
    envoyer(`/api/patients/${beneficiaireId}/brouillon`, "DELETE"),

  listerBilans: (beneficiaireId) =>
    requete(`/api/patients/${beneficiaireId}/bilans`),
  bilan: (id) => requete(`/api/bilans/${id}`),
  ouvrirBilanGuide: (beneficiaireId, corps) =>
    envoyer(`/api/patients/${beneficiaireId}/bilans`, "POST", corps),
  bilanPrecedent: (beneficiaireId, type) =>
    requete(`/api/patients/${beneficiaireId}/bilans/precedent?type=${type}`),
  modifierBilan: (id, corps) => envoyer(`/api/bilans/${id}`, "PATCH", corps),
  genererBilan: (beneficiaireId, corps) =>
    envoyer(`/api/patients/${beneficiaireId}/bilans/generate`, "POST", corps),

  lienExport: (bilanId) => `/api/bilans/${bilanId}/export.docx`,
};
