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
 * Le fichier obtenu est versionné (cf public/vendor/README.md) : ce script
 * sert à l'installer la première fois, à changer de version, et à vérifier son
 * intégrité — pas à le fournir au moment du déploiement. Il l'a fait un temps,
 * et une instance est partie en production sans lui, avec une dictée morte
 * que rien ne signalait avant le premier clic sur le micro.
 *
 * La source est le registre npm — celui dont proviennent déjà toutes les
 * dépendances du projet, donc aucun tiers supplémentaire. L'intégrité est
 * vérifiée contre une empreinte figée : si le contenu change, l'installation
 * échoue au lieu de servir un fichier inattendu.
 */
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { brotliCompressSync, brotliDecompressSync, constants, gunzipSync } from "node:zlib";
import path from "node:path";

const VERSION = "4.2.0";
const SHA256 = "e74bd32ed4453369ebb0edcaa27f6bc6204004a949a0233cdb87b62dda8d6978";
const ARCHIVE = `https://registry.npmjs.org/@huggingface/transformers/-/transformers-${VERSION}.tgz`;
const FICHIER_DANS_ARCHIVE = "package/dist/transformers.min.js";
const DESTINATION = path.join("public", "vendor", "transformers.min.js");

/**
 * C'est cette forme-là qui est versionnée, et celle que le serveur envoie au
 * navigateur (cf. src/middleware/statique.ts). Le fichier minifié, lui, reste
 * un artefact local : l'analyse de secrets de GitHub le refuse, ses noms de
 * classes ressemblant à des clés d'API.
 */
const DESTINATION_COMPRESSEE = `${DESTINATION}.br`;

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

/**
 * La bibliothèque est-elle déjà là, dans l'une ou l'autre forme, et conforme ?
 *
 * Le contrôle porte sur le contenu, pas sur la présence : c'est ce qui permet
 * à ce script de servir aussi de vérification d'intégrité, hors ligne, sur une
 * copie du dépôt.
 */
async function dejaPresent() {
  for (const fichier of [DESTINATION, DESTINATION_COMPRESSEE]) {
    try {
      const octets = await readFile(fichier);
      const contenu = fichier.endsWith(".br") ? brotliDecompressSync(octets) : octets;
      if (empreinte(contenu) === SHA256) {
        return true;
      }
    } catch {
      /* forme absente : on essaie la suivante */
    }
  }
  return false;
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

  // La forme compressée est produite ici plutôt qu'à la main : c'est elle qui
  // part dans le dépôt, elle doit donc toujours correspondre au fichier
  // vérifié à l'instant.
  const compresse = brotliCompressSync(contenu, {
    params: {
      [constants.BROTLI_PARAM_QUALITY]: 11,
      [constants.BROTLI_PARAM_SIZE_HINT]: contenu.length,
    },
  });
  await writeFile(DESTINATION_COMPRESSEE, compresse);

  console.log(
    `${DESTINATION} installé (${contenu.length} octets, empreinte vérifiée).\n` +
      `${DESTINATION_COMPRESSEE} régénéré (${compresse.length} octets) — c'est ce ` +
      `fichier qu'il faut commiter.`
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
