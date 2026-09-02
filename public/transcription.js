/**
 * Transcription vocale entièrement dans le navigateur (Whisper via
 * transformers.js / ONNX Runtime).
 *
 * Remplace l'ancienne chaîne serveur (upload → fichier sur disque → conteneur
 * Docker speaches). Conséquences :
 *  - aucun conteneur, aucun démon, aucun modèle à télécharger à la main ;
 *  - l'audio du bénéficiaire ne quitte jamais le poste de l'éducateur et
 *    n'est jamais écrit sur disque (minimisation RGPD structurelle, et non
 *    plus « supprimé après coup ») ;
 *  - la bibliothèque JavaScript est servie par notre propre origine
 *    (public/vendor/), et non depuis un CDN.
 *
 * Deux ressources restent téléchargées au premier usage, puis mises en cache
 * par le navigateur : le moteur d'inférence WebAssembly (jsDelivr, à une
 * version figée) et les poids du modèle (Hugging Face). Aucune donnée patient
 * n'est transmise lors de ces téléchargements, mais ils supposent un accès
 * réseau et font intervenir deux tiers. Pour les supprimer entièrement, voir
 * la section « Transcription vocale » du README.
 *
 * Attention au choix du fichier de bibliothèque : `transformers.web.min.js`
 * attend un empaqueteur et échoue dans le navigateur avec « Failed to resolve
 * module specifier "onnxruntime-web/webgpu" ». C'est `transformers.min.js`,
 * autonome, qui doit être servi ici.
 */

// Modèle Whisper multilingue au format ONNX. `base` est le compromis retenu :
// ~150 Mo, qualité correcte en français, latence acceptable sur CPU.
// Alternatives si besoin : "onnx-community/whisper-tiny" (plus rapide, moins
// précis) ou "onnx-community/whisper-small" (plus précis, nettement plus lent
// sans WebGPU). Les dépôts "Xenova/whisper-*" sont équivalents.
const MODELE = "onnx-community/whisper-base";

/**
 * Précision des poids. `undefined` laisse transformers.js prendre la variante
 * pleine précision publiée par le dépôt.
 *
 * Passer à "q8" (ou { encoder_model: "fp32", decoder_model_merged: "q4" } pour
 * WebGPU) divise le téléchargement initial par trois environ et accélère
 * l'instanciation, au prix d'une transcription un peu moins fidèle. C'est un
 * arbitrage sur la qualité du compte-rendu, pas un réglage technique : il se
 * change ici, en connaissance de cause, et se vérifie sur de vraies dictées.
 */
const PRECISION = undefined;

const BIBLIOTHEQUE = "/vendor/transformers.min.js";

// Whisper travaille exclusivement en mono 16 kHz.
const TAUX_ECHANTILLONNAGE = 16000;

/**
 * Mémorise qu'un chargement a déjà abouti sur ce poste. Sert uniquement à
 * décider si l'application peut préparer la dictée d'elle-même au démarrage :
 * si le modèle est déjà dans le cache du navigateur, l'y remettre ne coûte
 * aucun réseau. Aucune donnée de bénéficiaire n'est stockée.
 */
const CLE_DEJA_CHARGE = "dicteeModeleDejaCharge";

export function modeleDejaCharge() {
  try {
    return localStorage.getItem(CLE_DEJA_CHARGE) === "1";
  } catch {
    return false;
  }
}

function memoriserChargement() {
  try {
    localStorage.setItem(CLE_DEJA_CHARGE, "1");
  } catch {
    /* Stockage refusé : on retombe simplement sur la préparation à la demande. */
  }
}

let transcripteurPromise = null;
let transcripteurPret = false;

/**
 * Le modèle est-il déjà en mémoire ? L'interface s'en sert pour prévenir que
 * la première dictée déclenche un téléchargement, et seulement celle-là.
 */
export function modelePret() {
  return transcripteurPret;
}

/** Un chargement est-il en cours ? Évite d'en déclencher un second. */
export function chargementEnCours() {
  return transcripteurPromise !== null && !transcripteurPret;
}

/**
 * Charge la bibliothèque et instancie le pipeline. Le résultat est mémorisé :
 * le modèle n'est chargé qu'une fois par onglet, les dictées suivantes sont
 * immédiates.
 */
/**
 * Traduit une panne de chargement en quelque chose qu'on puisse traiter.
 *
 * `fetch` échoue avec un laconique « Failed to fetch » aussi bien quand le
 * poste est hors ligne que quand notre propre politique de sécurité refuse la
 * connexion. La distinction n'est visible que dans la console du navigateur,
 * là où personne ne va regarder : l'éducateur voit un message opaque et
 * conclut que la dictée est cassée. On l'écrit donc en clair.
 */
function expliquerEchec(err, urisBloquees) {
  const message = String(err && err.message ? err.message : err);

  if (urisBloquees.length > 0) {
    return (
      "le chargement a été refusé par la politique de sécurité de " +
      `l'application (${urisBloquees[0]}). C'est un réglage du serveur, pas ` +
      "une manipulation de votre part : signalez-le."
    );
  }
  if (message.includes("dynamically imported module")) {
    return (
      "le module de dictée est absent du serveur. Il s'installe avec " +
      "`npm run vendor:asr` ; signalez-le, la correction est côté serveur."
    );
  }
  if (message.includes("Failed to fetch") || message.includes("NetworkError")) {
    return (
      "le téléchargement du modèle n'a pas abouti. Vérifiez la connexion " +
      "internet du poste, puis réessayez — la reprise ne repart pas de zéro."
    );
  }
  return message;
}

function chargerTranscripteur(onProgression) {
  if (transcripteurPromise) {
    return transcripteurPromise;
  }

  // Une violation de CSP ne remonte pas dans l'exception : elle n'est
  // observable que par cet événement. On l'écoute le temps du chargement pour
  // pouvoir nommer la cause.
  const urisBloquees = [];
  const noterViolation = (evenement) => urisBloquees.push(evenement.blockedURI);
  document.addEventListener("securitypolicyviolation", noterViolation);

  transcripteurPromise = (async () => {
    let pipeline;
    let env;
    try {
      ({ pipeline, env } = await import(BIBLIOTHEQUE));
    } catch (err) {
      // Cas typique : `public/vendor/transformers.min.js` absent du serveur,
      // le fichier n'étant pas versionné mais récupéré à l'installation.
      throw new Error(expliquerEchec(err, urisBloquees));
    }

    // Les poids viennent du Hub ; aucun modèle n'est servi depuis notre origine
    // par défaut (cf. README pour basculer en local).
    env.allowLocalModels = false;

    // Cache du navigateur : c'est lui qui évite de retélécharger les poids à
    // chaque lancement. C'est le défaut de transformers.js, rendu explicite
    // parce que toute la stratégie de préparation en dépend.
    env.useBrowserCache = true;

    // WebGPU quand le navigateur le supporte (transcription plusieurs fois plus
    // rapide), repli sur WASM sinon.
    let derniereErreur;
    for (const device of ["webgpu", "wasm"]) {
      try {
        const transcripteur = await pipeline("automatic-speech-recognition", MODELE, {
          device,
          dtype: PRECISION,
          progress_callback: onProgression,
        });
        transcripteurPret = true;
        memoriserChargement();
        return transcripteur;
      } catch (err) {
        derniereErreur = err;
      }
    }
    throw new Error(expliquerEchec(derniereErreur, urisBloquees));
  })();

  // Un échec de chargement ne doit pas condamner l'onglet : on repart de zéro
  // au prochain essai.
  transcripteurPromise
    .catch(() => {
      transcripteurPromise = null;
    })
    .finally(() => {
      document.removeEventListener("securitypolicyviolation", noterViolation);
    });

  return transcripteurPromise;
}

/**
 * Décode un enregistrement (webm/opus, ogg, mp4…) en PCM mono 16 kHz.
 * `decodeAudioData` gère nativement les formats produits par MediaRecorder ;
 * `OfflineAudioContext` assure le rééchantillonnage et le mixage mono de
 * façon fiable sur tous les navigateurs.
 */
async function versPcmMono16k(blob) {
  const donnees = await blob.arrayBuffer();

  const contexte = new (window.AudioContext || window.webkitAudioContext)();
  let decode;
  try {
    decode = await contexte.decodeAudioData(donnees);
  } finally {
    contexte.close();
  }

  const nbEchantillons = Math.ceil(decode.duration * TAUX_ECHANTILLONNAGE);
  const horsEcran = new OfflineAudioContext(1, nbEchantillons, TAUX_ECHANTILLONNAGE);
  const source = horsEcran.createBufferSource();
  source.buffer = decode;
  source.connect(horsEcran.destination);
  source.start();

  const rendu = await horsEcran.startRendering();
  return rendu.getChannelData(0);
}

/**
 * Transcrit un enregistrement audio en texte français.
 *
 * @param {Blob} blob  enregistrement issu de MediaRecorder
 * @param {(etape: string, pourcentage?: number) => void} [onEtape]
 *        avancement pour l'UI ; le pourcentage n'est fourni que pendant un
 *        téléchargement, il permet d'afficher une barre plutôt qu'une attente
 *        sans fin
 * @returns {Promise<string>} texte transcrit
 */
export async function transcrire(blob, onEtape = () => {}) {
  onEtape("Préparation de l'audio…");
  const pcm = await versPcmMono16k(blob);

  if (pcm.length === 0) {
    throw new Error("Enregistrement vide");
  }

  onEtape("Chargement du modèle de transcription…");
  const transcripteur = await chargerTranscripteur((progression) => {
    if (progression.status === "progress" && progression.total) {
      const pct = Math.round((progression.loaded / progression.total) * 100);
      onEtape("Téléchargement du modèle de dictée…", pct);
    }
  });

  onEtape("Transcription en cours…");
  const resultat = await transcripteur(pcm, {
    language: "fr",
    task: "transcribe",
    // Whisper traite des fenêtres de 30 s ; le recouvrement évite de couper
    // un mot à la frontière de deux fenêtres sur les dictées longues.
    chunk_length_s: 30,
    stride_length_s: 5,
  });

  const texte = (resultat?.text ?? "").trim();
  if (!texte) {
    throw new Error("Aucune parole détectée dans l'enregistrement");
  }
  return texte;
}

/**
 * Prépare le modèle sans attendre une dictée.
 *
 * Le coût d'une première dictée se décompose en deux : le téléchargement des
 * poids (une seule fois par poste, ensuite servi par le cache) et
 * l'instanciation du graphe ONNX (quelques secondes, à chaque onglet). Les
 * deux peuvent se faire pendant que l'éducateur fait autre chose ; les subir
 * après avoir cliqué sur « Arrêter » n'apporte rien.
 *
 * Échec silencieux : ce n'est qu'une avance de phase, la dictée réessaiera.
 *
 * @param {(etape: string, pourcentage?: number, brut?: object) => void} [onEtape]
 *        le troisième argument est l'avancement tel que transformers.js le
 *        publie, fichier par fichier. L'écran de préparation en a besoin pour
 *        totaliser : un pourcentage par fichier ne dit rien de l'attente
 *        restante quand il y en a cinq à télécharger.
 * @returns {Promise<boolean>} le modèle est-il prêt au terme de l'appel
 */
let derniereErreurPreparation = null;

export function prechargerModele(onEtape = () => {}) {
  return chargerTranscripteur((progression) => {
    const pct =
      progression.status === "progress" && progression.total
        ? Math.round((progression.loaded / progression.total) * 100)
        : undefined;
    onEtape("Téléchargement du modèle de dictée…", pct, progression);
  })
    .then(() => true)
    .catch((err) => {
      // La préparation explicite, elle, doit pouvoir dire ce qui a manqué :
      // c'est un écran que l'éducateur regarde, pas une avance de phase muette.
      derniereErreurPreparation = err;
      return false;
    });
}

/** Message de la dernière préparation échouée, déjà traduit en clair. */
export function raisonEchecPreparation() {
  return derniereErreurPreparation ? derniereErreurPreparation.message : null;
}
