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

function envoyer(url, methode, corps, entetes = {}) {
  return requete(url, {
    method: methode,
    headers: { "Content-Type": "application/json", ...entetes },
    body: JSON.stringify(corps),
  });
}

export const api = {
  schemaBilan: () => requete("/api/schema/bilan"),

  listerEtablissements: () => requete("/api/etablissements"),
  creerEtablissement: (corps) => envoyer("/api/etablissements", "POST", corps),
  quota: (etablissementId) =>
    requete(`/api/etablissements/${etablissementId}/quota`),

  listerUtilisateurs: () => requete("/api/utilisateurs"),
  creerUtilisateur: (corps) => envoyer("/api/utilisateurs", "POST", corps),

  listerBeneficiaires: (etablissementId) =>
    requete(
      etablissementId
        ? `/api/patients?etablissement_id=${encodeURIComponent(etablissementId)}`
        : "/api/patients"
    ),
  creerBeneficiaire: (corps) => envoyer("/api/patients", "POST", corps),
  modifierBeneficiaire: (id, corps) => envoyer(`/api/patients/${id}`, "PATCH", corps),

  listerBilans: (beneficiaireId) =>
    requete(`/api/patients/${beneficiaireId}/bilans`),
  bilan: (id) => requete(`/api/bilans/${id}`),
  modifierBilan: (id, corps) => envoyer(`/api/bilans/${id}`, "PATCH", corps),
  genererBilan: (beneficiaireId, auteurId, corps) =>
    envoyer(`/api/patients/${beneficiaireId}/bilans/generate`, "POST", corps, {
      "x-user-id": auteurId,
    }),

  lienExport: (bilanId) => `/api/bilans/${bilanId}/export.docx`,
};
