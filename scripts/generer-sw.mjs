/**
 * Produit le service worker à partir de son modèle, de la version courante et
 * de ce que `public/` contient réellement.
 *
 * Deux défauts disparaissent, tous deux invisibles jusqu'au moment le plus
 * gênant :
 *
 *  - **la liste de préchargement écrite à la main.** Un fichier ajouté à
 *    l'interface et oublié ici ne casse rien à l'écran : il manque seulement
 *    hors réseau, c'est-à-dire là où l'on ne peut plus rien corriger. Elle est
 *    désormais relevée sur le disque ;
 *  - **le numéro de cache à incrémenter.** Tant qu'il ne changeait pas, le
 *    fichier restait identique d'un déploiement à l'autre, le navigateur ne
 *    voyait aucune mise à jour, et l'appareil gardait l'ancienne interface. Le
 *    nom du cache porte maintenant la version, qui change à chaque
 *    construction.
 *
 *   npm run generer:sw
 */
import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
/**
 * La version est *lue*, pas recalculée.
 *
 * Deux appels à `versionCourante()` séparés d'une seconde produisent deux
 * identités différentes : le cache du service worker ne portait alors pas le
 * même nom que la version publiée sur /version.json. L'appareil se serait cru
 * en retard sur lui-même, indéfiniment.
 */

const RACINE = "public";
const MODELE = path.join(RACINE, "sw.modele.js");
const DESTINATION = path.join(RACINE, "sw.js");

/**
 * Ce qui doit être disponible hors réseau.
 *
 * Tout `public/` sauf ce qui n'a pas à l'être : les moteurs WebAssembly, mis
 * en cache au premier usage parce que précharger seize mégaoctets punirait
 * l'utilisateur d'avoir installé ; les fichiers générés du service worker
 * lui-même ; et `version.json`, dont tout l'intérêt est de n'être jamais servi
 * depuis un cache.
 */
const EXCLUS = [/^vendor\//, /^sw\.js$/, /^sw\.modele\.js$/, /^version\.json$/];
const EXTENSIONS = [".html", ".css", ".js", ".png", ".svg", ".webmanifest"];

async function fichiersAPrecharger(dossier = RACINE, prefixe = "") {
  const trouves = [];
  for (const entree of await readdir(dossier, { withFileTypes: true })) {
    const relatif = prefixe ? `${prefixe}/${entree.name}` : entree.name;
    if (EXCLUS.some((motif) => motif.test(relatif))) continue;

    if (entree.isDirectory()) {
      trouves.push(...(await fichiersAPrecharger(path.join(dossier, entree.name), relatif)));
    } else if (EXTENSIONS.includes(path.extname(entree.name))) {
      trouves.push(`/${relatif}`);
    }
  }
  return trouves;
}

async function versionPubliee() {
  try {
    return JSON.parse(await readFile(path.join(RACINE, "version.json"), "utf8"));
  } catch {
    throw new Error(
      "public/version.json est absent. Produisez-le d'abord :\n" +
        "  npm run generer:version"
    );
  }
}

export async function construireServiceWorker() {
  const modele = await readFile(MODELE, "utf8");
  const version = await versionPubliee();
  const fichiers = (await fichiersAPrecharger()).sort();

  // `/` en tête : c'est l'adresse qu'ouvre l'application installée, et elle
  // doit répondre hors réseau même si personne n'a jamais visité `/index.html`.
  const liste = ["/", ...fichiers];

  return modele
    .replace("__VERSION__", version.id)
    .replace(
      "__PRECACHE__",
      liste.map((chemin) => `  ${JSON.stringify(chemin)},`).join("\n")
    );
}

async function main() {
  const contenu = await construireServiceWorker();
  await writeFile(DESTINATION, contenu, "utf8");
  const nombre = (contenu.match(/^ {2}"\//gm) || []).length;
  console.log(`${DESTINATION} écrit : ${nombre} fichiers préchargés.`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error("Échec de la génération du service worker :", err.message);
    process.exit(1);
  });
}
