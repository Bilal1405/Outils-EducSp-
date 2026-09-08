/**
 * Le seul appel qui sort de l'appareil.
 *
 * Tout le reste de la version pour praticien indépendant se passe de réseau :
 * la base est sur le téléphone, l'interface est en cache, la dictée s'exécute
 * dans le navigateur. Un modèle de langage, lui, ne tient pas dans un
 * téléphone. La rédaction assistée et la mise au propre d'un commentaire
 * passent donc par le serveur qui a servi l'application — même origine, donc
 * aucune règle de sécurité à élargir.
 *
 * Trois choses en découlent, toutes visibles à l'écran plutôt que devinées :
 *
 *  - **il faut du réseau**, et seulement pour ces deux gestes ;
 *  - **il faut une clé d'activation**, que le praticien colle une fois dans les
 *    réglages. Elle vit dans le stockage du navigateur, jamais dans la base :
 *    la base part dans les sauvegardes, et un fichier de sauvegarde circule ;
 *  - **les noms sont retirés avant l'envoi** par `masquage.js`, et remis en
 *    place au retour.
 */

/**
 * Le stockage du navigateur, écarté partout ailleurs dans ce projet parce
 * qu'il déposerait des données de santé sur le disque du poste. Une clé
 * d'activation n'en est pas une — et surtout, c'est le seul endroit où elle ne
 * risque pas de partir dans un fichier de sauvegarde.
 */
const CLE_STOCKAGE = "educsp-cle-activation";

export function cleActivation() {
  try {
    return localStorage.getItem(CLE_STOCKAGE) || "";
  } catch {
    // Navigation privée, stockage refusé : la rédaction assistée sera annoncée
    // comme non activée, ce qui est exact.
    return "";
  }
}

export function definirCleActivation(valeur) {
  const cle = String(valeur || "").trim();
  try {
    if (cle) localStorage.setItem(CLE_STOCKAGE, cle);
    else localStorage.removeItem(CLE_STOCKAGE);
  } catch {
    /* Le choix vaut pour cette session, faute de pouvoir être retenu. */
  }
  return cle;
}

export function assistanceActivee() {
  return cleActivation().length > 0;
}

/**
 * Erreur d'assistance : porte un message destiné à être lu par l'éducateur, et
 * un motif que l'interface peut traiter différemment.
 */
export class ErreurAssistance extends Error {
  constructor(message, motif) {
    super(message);
    this.name = "ErreurAssistance";
    this.motif = motif;
  }
}

/**
 * Appelle le serveur. Ne rend jamais une valeur par défaut : chaque échec est
 * nommé, parce qu'« il ne s'est rien passé » est le pire des retours quand on
 * vient de dicter dix minutes.
 */
async function appeler(chemin, corps) {
  const cle = cleActivation();
  if (!cle) {
    throw new ErreurAssistance(
      "La rédaction assistée n'est pas activée sur cet appareil. " +
        "Ouvrez les réglages, section « Rédaction assistée », pour y coller " +
        "votre clé.",
      "sans-cle"
    );
  }

  // Posé avant l'appel : `navigator.onLine` ment dans un sens — il peut
  // affirmer une connexion qui ne mène nulle part — mais quand il dit
  // « hors ligne », il a raison, et cela évite une attente pour rien.
  if (navigator.onLine === false) {
    throw new ErreurAssistance(
      "La rédaction assistée demande une connexion. Le reste de " +
        "l'application fonctionne sans réseau : vous pouvez continuer à " +
        "écrire, et relancer la rédaction plus tard.",
      "hors-reseau"
    );
  }

  let reponse;
  try {
    reponse = await fetch(chemin, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        // Garde anti-CSRF du serveur : une écriture sans cet en-tête est
        // refusée, clé d'activation ou non.
        "x-outils-educsp": "1",
        "x-cle-activation": cle,
      },
      body: JSON.stringify(corps),
    });
  } catch {
    throw new ErreurAssistance(
      "Le serveur de rédaction n'a pas répondu. Vérifiez votre connexion ; " +
        "votre compte-rendu est intact sur l'appareil.",
      "hors-reseau"
    );
  }

  let donnees = null;
  try {
    donnees = await reponse.json();
  } catch {
    /* Une réponse non-JSON est traitée comme une panne, ci-dessous. */
  }

  if (!reponse.ok) {
    const message = donnees?.error || "La rédaction assistée a échoué.";
    throw new ErreurAssistance(
      message,
      reponse.status === 401 ? "cle-refusee" : reponse.status === 503 ? "fermee" : "echec"
    );
  }
  return donnees;
}

/** Rédige un bilan à partir d'un compte-rendu **déjà masqué**. */
export async function redigerBilan(texteMasque, precedent) {
  const donnees = await appeler("/api/local/redaction", {
    texte: texteMasque,
    // Seules les deux sections que le prompt lit réellement : l'en-tête d'un
    // bilan porte un nom, il n'a rien à faire dans un envoi.
    precedent: precedent
      ? {
          evaluation_objectifs_par_domaine:
            precedent.evaluation_objectifs_par_domaine ?? [],
          proposition_objectifs_periode_suivante:
            precedent.proposition_objectifs_periode_suivante ?? [],
        }
      : undefined,
  });
  if (!donnees?.contenu) {
    throw new ErreurAssistance(
      "Le serveur n'a rien rendu de rédigeable. Votre compte-rendu est intact.",
      "echec"
    );
  }
  return donnees.contenu;
}

/** Met au propre un commentaire **déjà masqué**. */
export async function reformuler(texteMasque, intitule) {
  const donnees = await appeler("/api/local/reformulation", {
    texte: texteMasque,
    intitule,
  });
  if (typeof donnees?.texte !== "string") {
    throw new ErreurAssistance(
      "Le serveur n'a rien rendu. Votre texte n'a pas été modifié.",
      "echec"
    );
  }
  return donnees.texte;
}
