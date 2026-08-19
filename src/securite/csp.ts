/**
 * Politique de sécurité du contenu (CSP).
 *
 * Isolée dans son propre module parce qu'elle est fragile d'une manière
 * particulière : trop large, elle ne protège plus ; trop étroite, elle casse
 * la dictée vocale — et l'échec se manifeste par un « Failed to fetch »
 * incompréhensible, plusieurs écrans plus loin, chez l'utilisateur. Chaque
 * exception ci-dessous est donc justifiée nommément, et bordée par
 * `test/csp.test.ts`.
 */

/**
 * Version d'ONNX Runtime que transformers.js va chercher.
 *
 * Elle n'est pas choisie ici : la bibliothèque construit elle-même l'URL
 * `https://cdn.jsdelivr.net/npm/onnxruntime-web@${versions.web}/dist/`, où
 * `versions.web` est figé dans le paquet `@huggingface/transformers` installé.
 * L'autorisation est restreinte à ce dossier précis plutôt qu'au CDN entier :
 * le script chargé s'exécute dans une page qui affiche des données de santé,
 * et une compromission de jsDelivr ne doit pas suffire à y injecter du code
 * arbitraire.
 *
 * En cas de mise à jour de transformers.js, cette constante doit suivre —
 * `test/csp.test.ts` compare avec la version réellement embarquée et échoue
 * sinon.
 */
export const VERSION_ONNX_RUNTIME = "1.26.0-dev.20260416-b7804b056c";

const DOSSIER_ONNX_RUNTIME =
  `https://cdn.jsdelivr.net/npm/onnxruntime-web@${VERSION_ONNX_RUNTIME}/dist/`;

/**
 * Hôtes de stockage de Hugging Face.
 *
 * Le premier appel part bien vers `huggingface.co`, mais les poids du modèle
 * sont des fichiers volumineux : la réponse est une redirection vers leur
 * stockage (`cdn-lfs-us-1.hf.co`, `cas-bridge.xethub.hf.co`,
 * `cdn-lfs.huggingface.co` selon les dépôts et les régions). Une CSP
 * s'applique **à la cible de la redirection**, pas seulement à l'URL
 * demandée : sans ces entrées, le téléchargement du modèle échoue en
 * `TypeError: Failed to fetch`, sans autre explication.
 *
 * Ce sont des lectures de fichiers publics : aucune donnée de bénéficiaire
 * n'est transmise, et rien de ce qui vient de là ne s'exécute comme script.
 */
const STOCKAGE_MODELES = ["https://huggingface.co", "https://*.hf.co", "https://*.huggingface.co"];

export const POLITIQUE_CSP = [
  "default-src 'self'",
  "img-src 'self' data:",
  "style-src 'self' 'unsafe-inline'",
  // `wasm-unsafe-eval` : l'instanciation d'un module WebAssembly, sans quoi
  // aucune transcription n'est possible. Ce n'est pas `unsafe-eval`.
  `script-src 'self' 'wasm-unsafe-eval' ${DOSSIER_ONNX_RUNTIME}`,
  // ONNX Runtime crée ses fils d'exécution à partir de blobs.
  "worker-src 'self' blob:",
  `connect-src 'self' ${STOCKAGE_MODELES.join(" ")} https://cdn.jsdelivr.net`,
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join("; ");
