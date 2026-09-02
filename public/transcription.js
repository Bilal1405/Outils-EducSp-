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
export const MODELE = "onnx-community/whisper-base";

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

export const BIBLIOTHEQUE = "/vendor/transformers.min.js";

/**
 * Réglages d'appel de Whisper, partagés avec la page de comparaison des
 * précisions : une comparaison qui ne transcrirait pas exactement comme
 * l'application ne dirait rien de l'application.
 */
export const OPTIONS_TRANSCRIPTION = {
  language: "fr",
  task: "transcribe",
  // Whisper traite des fenêtres de 30 s ; le recouvrement évite de couper
  // un mot à la frontière de deux fenêtres sur les dictées longues.
  chunk_length_s: 30,
  stride_length_s: 5,
};

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

/** « webgpu » ou « wasm » : sur quoi tourne réellement le modèle chargé. */
let peripheriqueUtilise = null;

/**
 * WebGPU a-t-il été écarté pour cet onglet ?
 *
 * Un pilote peut accepter de construire le graphe puis échouer à l'exécuter —
 * la panne n'apparaît alors qu'au moment de transcrire, et se reproduirait à
 * chaque dictée. On s'en souvient, et l'on repart directement sur WASM.
 */
let forcerWasm = false;

export function peripheriqueDeTranscription() {
  return peripheriqueUtilise;
}

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

/**
 * Une transcription qui échoue une fois le modèle chargé.
 *
 * Le message porte le périphérique : c'est l'information qui manquait pour
 * distinguer, dans un signalement, un poste dont le pilote graphique refuse
 * d'exécuter le graphe d'un poste où c'est autre chose qui cloche. Sans elle,
 * deux pannes très différentes se ressemblent.
 */
function decrireEchecTranscription(err) {
  const message = String(err && err.message ? err.message : err);
  return (
    `la transcription a échoué alors que le modèle était chargé ` +
    `(exécution ${peripheriqueUtilise ?? "inconnue"}) : ${message}`
  );
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
    // rapide), repli sur WASM sinon — et repli aussi quand WebGPU s'est déjà
    // montré incapable de transcrire dans cet onglet (cf. `transcrire`).
    let derniereErreur;
    for (const device of forcerWasm ? ["wasm"] : ["webgpu", "wasm"]) {
      try {
        const transcripteur = await pipeline("automatic-speech-recognition", MODELE, {
          device,
          dtype: PRECISION,
          progress_callback: onProgression,
        });
        transcripteurPret = true;
        peripheriqueUtilise = device;
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
export async function versPcmMono16k(blob) {
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
 * Charge le modèle et l'exécute sur du PCM, avec repli si l'accélération
 * graphique se dérobe.
 *
 * Le repli sur WASM prévu au chargement ne couvrait que la construction du
 * graphe ONNX. Or un pilote graphique peut accepter de le construire, puis
 * refuser de l'exécuter : la panne n'apparaît alors qu'ici — après que
 * l'éducateur a parlé — et rien ne la rattrapait. C'est la seule configuration
 * où l'outil paraissait correctement installé (bibliothèque présente, modèle
 * téléchargé, WebGPU annoncé disponible) et ne transcrivait rien.
 *
 * On refait donc le graphe sur WASM, une fois, et l'on garde la leçon pour le
 * reste de l'onglet : plus lent, mais cela transcrit.
 *
 * Chemin partagé avec `essaiTechnique` : un contrôle de diagnostic qui
 * n'emprunterait pas le même chemin que la dictée annoncerait des pannes que
 * l'outil rattrape, ou raterait celles qu'il ne rattrape pas.
 */
async function executerModele(pcm, onEtape) {
  const suivreTelechargement = (progression) => {
    if (progression.status === "progress" && progression.total) {
      const pct = Math.round((progression.loaded / progression.total) * 100);
      onEtape("Téléchargement du modèle de dictée…", pct);
    }
  };

  onEtape("Chargement du modèle de transcription…");
  let transcripteur = await chargerTranscripteur(suivreTelechargement);

  onEtape("Transcription en cours…");
  try {
    return await transcripteur(pcm, OPTIONS_TRANSCRIPTION);
  } catch (err) {
    if (peripheriqueUtilise !== "webgpu") {
      throw new Error(decrireEchecTranscription(err));
    }
    // eslint-disable-next-line no-console
    console.warn("[dictée] WebGPU n'a pas pu transcrire, repli sur WASM", err);
    forcerWasm = true;
    transcripteurPromise = null;
    transcripteurPret = false;

    onEtape("Nouvelle tentative sans accélération graphique…");
    transcripteur = await chargerTranscripteur(suivreTelechargement);
    try {
      return await transcripteur(pcm, OPTIONS_TRANSCRIPTION);
    } catch (err2) {
      throw new Error(decrireEchecTranscription(err2));
    }
  }
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

  const resultat = await executerModele(pcm, onEtape);
  const texte = (resultat?.text ?? "").trim();
  if (!texte) {
    throw new Error("Aucune parole détectée dans l'enregistrement");
  }
  return texte;
}

/**
 * Charge le modèle et l'exécute vraiment, sur une seconde de silence.
 *
 * Le diagnostic vérifiait jusqu'ici que tout était *joignable* — bibliothèque
 * servie, huggingface.co accessible, WebGPU annoncé — sans jamais faire
 * tourner le modèle. Un poste dont le pilote graphique construit le graphe
 * puis refuse de l'exécuter passait donc tous les contrôles au vert pendant
 * que la dictée échouait. C'est le seul contrôle qui pouvait le voir : il
 * fait exactement ce que fait une dictée, sans micro et sans parole.
 *
 * Le texte rendu n'a aucun intérêt — du silence ne dit rien. Ce qui compte
 * est qu'aucune exception ne soit levée, et sur quel périphérique.
 *
 * @returns {Promise<{ peripherique: string, dureeMs: number }>}
 */
export async function essaiTechnique(onEtape = () => {}) {
  const silence = new Float32Array(TAUX_ECHANTILLONNAGE);
  const debut = performance.now();
  await executerModele(silence, onEtape);
  return {
    peripherique: peripheriqueUtilise ?? "inconnu",
    dureeMs: performance.now() - debut,
  };
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
