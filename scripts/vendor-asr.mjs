/**
 * Récupère la bibliothèque de transcription vocale (transformers.js) et la
 * dépose dans public/vendor/, d'où l'application la sert elle-même.
 *
 * Pourquoi ne pas simplement pointer une balise <script> vers un CDN : le
 * JavaScript exécuté dans la page a accès à toutes les données affichées
 * (identité des bénéficiaires, contenu des bilans). Une compromission du CDN
 * suffirait à les exfiltrer. En servant le fichier depuis notre origine, le
 * navigateur ne charge jamais de code tiers.
 *
 * Pourquoi ne pas commiter le fichier : minifié, il contient des suites de
 * caractères que l'analyse de secrets de GitHub confond avec des clés d'API
 * (ce sont les noms de classes exportées par la bibliothèque, du type
 * `BlenderbotForConditionalGeneration`). Le télécharger à l'installation
 * évite ce faux positif tout en gardant le même résultat.
 *
 * La source est le registre npm — celui dont proviennent déjà toutes les
 * dépendances du projet, donc aucun tiers supplémentaire. L'intégrité est
 * vérifiée contre une empreinte figée : si le contenu change, l'installation
 * échoue au lieu de servir un fichier inattendu.
 */
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { gunzipSync } from "node:zlib";
import path from "node:path";

const VERSION = "4.2.0";
const SHA256 = "0a96dcf4c48981b7d05f53827e6975ec239132606ad0d526bbc2db0fcdbc4ded";
const ARCHIVE = `https://registry.npmjs.org/@huggingface/transformers/-/transformers-${VERSION}.tgz`;
const FICHIER_DANS_ARCHIVE = "package/dist/transformers.web.min.js";
const DESTINATION = path.join("public", "vendor", "transformers.min.js");

function empreinte(donnees) {
  return createHash("sha256").update(donnees).digest("hex");
}

/**
 * Extrait un fichier d'une archive tar décompressée.
 *
 * Le format tar est une suite d'en-têtes de 512 octets, chacun suivi du
 * contenu du fichier complété jusqu'au multiple de 512 supérieur. Le lire à
 * la main évite d'ajouter une dépendance et de dépendre d'un binaire `tar`
 * système, absent ou différent selon les postes.
 */
function extraireDeArchive(tar, cheminVoulu) {
  let position = 0;

  while (position + 512 <= tar.length) {
    const enTete = tar.subarray(position, position + 512);
    const nom = enTete.subarray(0, 100).toString("utf8").replace(/\0.*$/, "");

    // Un nom vide marque les blocs de fin d'archive.
    if (nom === "") {
      break;
    }

    const taille =
      parseInt(
        enTete.subarray(124, 136).toString("utf8").replace(/\0.*$/, "").trim(),
        8
      ) || 0;
    const debutContenu = position + 512;

    if (nom === cheminVoulu) {
      return tar.subarray(debutContenu, debutContenu + taille);
    }

    position = debutContenu + Math.ceil(taille / 512) * 512;
  }

  return null;
}

/** Le fichier attendu est-il déjà en place ? Évite un téléchargement inutile. */
async function dejaPresent() {
  try {
    return empreinte(await readFile(DESTINATION)) === SHA256;
  } catch {
    return false;
  }
}

async function principal() {
  if (await dejaPresent()) {
    console.log(`transformers.js ${VERSION} déjà présent, rien à faire.`);
    return;
  }

  console.log(`Téléchargement de transformers.js ${VERSION} depuis npm…`);
  const reponse = await fetch(ARCHIVE);
  if (!reponse.ok) {
    throw new Error(
      `Téléchargement échoué (${reponse.status} ${reponse.statusText}) : ${ARCHIVE}`
    );
  }

  const tar = gunzipSync(Buffer.from(await reponse.arrayBuffer()));
  const contenu = extraireDeArchive(tar, FICHIER_DANS_ARCHIVE);
  if (!contenu) {
    throw new Error(
      `${FICHIER_DANS_ARCHIVE} absent de l'archive : la structure du paquet a ` +
        `changé en version ${VERSION}.`
    );
  }

  const obtenue = empreinte(contenu);
  if (obtenue !== SHA256) {
    throw new Error(
      `Empreinte inattendue pour transformers.js ${VERSION}.\n` +
        `  attendue : ${SHA256}\n  obtenue  : ${obtenue}\n` +
        `Le fichier distant a changé : ne pas l'installer sans vérification.`
    );
  }

  await mkdir(path.dirname(DESTINATION), { recursive: true });
  await writeFile(DESTINATION, contenu);
  console.log(
    `${DESTINATION} installé (${contenu.length} octets, empreinte vérifiée).`
  );
}

/**
 * `--tolerant` (utilisé par le postinstall) signale l'échec sans interrompre
 * l'installation : un poste hors ligne, ou un registre momentanément
 * injoignable, ne doit pas empêcher d'installer et de faire tourner le reste
 * de l'application. Lancé à la main (`npm run vendor:asr`), le script échoue
 * franchement.
 */
const tolerant = process.argv.includes("--tolerant");

principal().catch((err) => {
  console.error(`\n[vendor-asr] ${err.message}\n`);
  console.error(
    "La dictée vocale ne fonctionnera pas tant que ce fichier est absent " +
      "(relancer : npm run vendor:asr). Le reste de l'application n'est pas " +
      "affecté."
  );
  process.exit(tolerant ? 0 : 1);
});
