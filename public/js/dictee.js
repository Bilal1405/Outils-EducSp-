/**
 * Dictée vocale, partagée entre l'écran de rédaction classique et les
 * parcours guidés.
 *
 * Un seul enregistrement à la fois pour toute l'application : deux micros
 * ouverts en même temps ne produiraient rien d'utilisable, et le modèle de
 * transcription est de toute façon unique.
 *
 * L'appelant fournit deux rappels et ne connaît rien du reste :
 *   onEtat(etat, detail)  "enregistrement" | "preparation" | "transcription"
 *                         | "termine" | "erreur", avec un message affichable
 *                         et, pendant un téléchargement, un pourcentage ;
 *   onTexte(texte)        texte transcrit, une seule fois, en fin de dictée.
 */

let enregistreur = null;
let flux = null;
let morceaux = [];
let rappels = null;
let preparationLancee = false;

export function dicteeEnCours() {
  return enregistreur !== null && enregistreur.state === "recording";
}

function signaler(etat, detail = "", pourcentage) {
  if (rappels && rappels.onEtat) {
    rappels.onEtat(etat, detail, pourcentage);
  }
}

/**
 * Prépare le modèle en avance de phase.
 *
 * Une première dictée coûte deux choses : le téléchargement des poids — une
 * fois par poste, ensuite servi par le cache du navigateur — et l'instanciation
 * du graphe, quelques secondes à chaque onglet. Rien n'oblige à payer cela
 * après le clic sur « Arrêter », au moment précis où l'on attend son texte.
 *
 * Un téléchargement réel est toujours annoncé : engager plusieurs dizaines de
 * mégaoctets en silence n'est pas acceptable.
 */
export async function preparer() {
  if (preparationLancee) return;
  preparationLancee = true;

  try {
    const module = await import("/transcription.js");
    if (module.modelePret()) return;

    await module.prechargerModele((etape, pourcentage) => {
      signaler("preparation", etape, pourcentage);
    });
    signaler("termine", "");
  } catch {
    // Nouvelle tentative permise au prochain déclencheur.
    preparationLancee = false;
  }
}

/**
 * Préparation automatique, uniquement si le modèle a déjà été chargé sur ce
 * poste : il est alors dans le cache, la remise en mémoire ne consomme aucun
 * réseau. Sinon on attend un geste explicite — personne ne doit déclencher un
 * gros téléchargement sans le vouloir.
 */
export function planifierPreparation() {
  if (preparationLancee) return;
  if (navigator.connection && navigator.connection.saveData) return;

  const lancer = () => {
    import("/transcription.js")
      .then((module) => {
        if (module.modeleDejaCharge()) {
          preparer();
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

export function arreter() {
  if (enregistreur && enregistreur.state !== "inactive") {
    enregistreur.stop();
  }
}

async function transcrire(blob) {
  try {
    const module = await import("/transcription.js");

    if (!module.modelePret()) {
      signaler(
        "preparation",
        module.chargementEnCours()
          ? "Préparation de la dictée en cours…"
          : "Premier usage : téléchargement du modèle de dictée (une seule fois)."
      );
    }

    const texte = await module.transcrire(blob, (etape, pourcentage) => {
      signaler("transcription", etape, pourcentage);
    });

    if (rappels && rappels.onTexte) {
      rappels.onTexte(texte);
    }
    signaler("termine", "");
  } catch (err) {
    signaler(
      "erreur",
      `La dictée a échoué : ${err.message} Pour savoir ce qui manque sur ce ` +
        "poste, ouvrez /diagnostic.html"
    );
  } finally {
    rappels = null;
  }
}

/**
 * Démarre ou arrête la dictée. Un appel pendant un enregistrement en cours
 * l'arrête, quels que soient les rappels fournis : c'est le même micro.
 */
export async function basculer(nouveauxRappels) {
  if (dicteeEnCours()) {
    arreter();
    return;
  }

  rappels = nouveauxRappels;

  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    signaler("erreur", "Ce navigateur ne permet pas l'enregistrement audio.");
    rappels = null;
    return;
  }

  try {
    flux = await navigator.mediaDevices.getUserMedia({ audio: true });
  } catch {
    signaler(
      "erreur",
      "Accès au micro refusé. Autorisez-le dans les réglages du navigateur."
    );
    rappels = null;
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
    flux.getTracks().forEach((piste) => piste.stop());
    flux = null;

    if (morceaux.length === 0) {
      signaler("termine", "");
      rappels = null;
      return;
    }
    const blob = new Blob(morceaux, { type: enregistreur.mimeType || "audio/webm" });
    morceaux = [];
    await transcrire(blob);
  });

  enregistreur.start();
  signaler("enregistrement", "Enregistrement… parlez normalement.");

  // Le modèle se charge pendant que la personne parle : à l'arrêt, il n'y a
  // plus qu'à transcrire.
  preparer();
}
