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

const BIBLIOTHEQUE = "/vendor/transformers.min.js";

// Whisper travaille exclusivement en mono 16 kHz.
const TAUX_ECHANTILLONNAGE = 16000;

let transcripteurPromise = null;
let transcripteurPret = false;

/**
 * Le modèle est-il déjà en mémoire ? L'interface s'en sert pour prévenir que
 * la première dictée déclenche un téléchargement, et seulement celle-là.
 */
export function modelePret() {
  return transcripteurPret;
}

/**
 * Charge la bibliothèque et instancie le pipeline. Le résultat est mémorisé :
 * le modèle n'est chargé qu'une fois par onglet, les dictées suivantes sont
 * immédiates.
 */
function chargerTranscripteur(onProgression) {
  if (transcripteurPromise) {
    return transcripteurPromise;
  }

  transcripteurPromise = (async () => {
    const { pipeline, env } = await import(BIBLIOTHEQUE);

    // Les poids viennent du Hub ; aucun modèle n'est servi depuis notre origine
    // par défaut (cf. README pour basculer en local).
    env.allowLocalModels = false;

    // WebGPU quand le navigateur le supporte (transcription plusieurs fois plus
    // rapide), repli sur WASM sinon.
    let derniereErreur;
    for (const device of ["webgpu", "wasm"]) {
      try {
        const transcripteur = await pipeline("automatic-speech-recognition", MODELE, {
          device,
          progress_callback: onProgression,
        });
        transcripteurPret = true;
        return transcripteur;
      } catch (err) {
        derniereErreur = err;
      }
    }
    throw derniereErreur;
  })();

  // Un échec de chargement ne doit pas condamner l'onglet : on repart de zéro
  // au prochain essai.
  transcripteurPromise.catch(() => {
    transcripteurPromise = null;
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
 * Déclenche le téléchargement du modèle sans attendre une dictée, pour que le
 * premier usage réel ne subisse pas l'attente. Échec silencieux : ce n'est
 * qu'une optimisation de confort.
 */
export function prechargerModele(onEtape = () => {}) {
  return chargerTranscripteur((progression) => {
    if (progression.status === "progress" && progression.total) {
      const pct = Math.round((progression.loaded / progression.total) * 100);
      onEtape(`Préparation du modèle de dictée : ${pct} %`);
    }
  }).catch(() => {});
}
