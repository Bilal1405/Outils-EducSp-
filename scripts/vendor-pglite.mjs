/**
 * Dépose PGlite — PostgreSQL compilé en WebAssembly — dans public/vendor/pglite/,
 * d'où l'application le sert elle-même.
 *
 * C'est ce qui permet à la version pour praticien indépendant d'exister : la
 * base de données vit dans le navigateur du téléphone, sans hébergeur. Pas
 * d'hébergeur, donc pas de certification HDS à obtenir, pas de base supprimée
 * au bout de trente jours, et aucune donnée de santé qui sorte de l'appareil.
 *
 * Même raison que pour la bibliothèque de transcription de ne rien charger
 * depuis un CDN : le code exécuté dans la page voit tout ce que la page
 * affiche. Ici il verrait la base entière.
 *
 * La source est `node_modules` — le paquet est déjà une dépendance du projet,
 * éprouvée côté serveur par `test/baseEmbarquee.test.ts`. Rien n'est
 * téléchargé : on copie ce qui est installé, ce qui garantit que le navigateur
 * et le serveur exécutent exactement le même PostgreSQL.
 *
 *   npm run vendor:pglite
 */
import { copyFile, mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { brotliCompressSync, constants } from "node:zlib";
import path from "node:path";

const SOURCE = path.join("node_modules", "@electric-sql", "pglite", "dist");
const DESTINATION = path.join("public", "vendor", "pglite");

/**
 * Ce qu'il faut copier, et rien d'autre.
 *
 * `dist/` contient aussi une quarantaine d'extensions PostgreSQL en archives,
 * des cartes de source et des variantes Node : une centaine de mégaoctets dont
 * le navigateur n'a aucun usage. `index.js` résout ses ressources par
 * `new URL("pglite.wasm", import.meta.url)` — les fichiers doivent donc être
 * voisins, et le sont ici.
 */
const FICHIERS = ["index.js", "pglite.wasm", "pglite.data", "initdb.wasm"];
const MOTIF_MORCEAUX = /^chunk-[A-Z0-9]+\.js$/;

/**
 * Le serveur sait servir un `.br` à la place du fichier nu (cf.
 * `src/middleware/statique.ts`). On compresse donc à l'avance : 16 Mo bruts
 * deviennent 4,3 Mo sur le réseau, et c'est un téléphone qui télécharge, une
 * fois, avant de pouvoir travailler hors ligne.
 */
function compresser(donnees) {
  return brotliCompressSync(donnees, {
    params: {
      [constants.BROTLI_PARAM_QUALITY]: 11,
      [constants.BROTLI_PARAM_SIZE_HINT]: donnees.length,
    },
  });
}

async function main() {
  if (!existsSync(SOURCE)) {
    console.error(
      `${SOURCE} est absent.\n` +
        "PGlite est une dépendance optionnelle : installez-la avec\n" +
        "  npm install @electric-sql/pglite"
    );
    process.exit(1);
  }

  await mkdir(DESTINATION, { recursive: true });

  const morceaux = (await readdir(SOURCE)).filter((nom) => MOTIF_MORCEAUX.test(nom));
  if (morceaux.length === 0) {
    console.error(
      "Aucun fichier `chunk-*.js` trouvé : la mise en paquet de PGlite a changé.\n" +
        "Vérifier ce dont `index.js` a besoin avant de continuer."
    );
    process.exit(1);
  }

  let brut = 0;
  let compresse = 0;

  for (const nom of [...FICHIERS, ...morceaux]) {
    const source = path.join(SOURCE, nom);
    const donnees = await readFile(source);
    await copyFile(source, path.join(DESTINATION, nom));

    const petit = compresser(donnees);
    await writeFile(path.join(DESTINATION, `${nom}.br`), petit);

    brut += donnees.length;
    compresse += petit.length;
    console.log(
      `  ${nom.padEnd(22)} ${(donnees.length / 1048576).toFixed(1).padStart(5)} Mo` +
        ` → ${(petit.length / 1048576).toFixed(1).padStart(5)} Mo`
    );
  }

  const paquet = JSON.parse(
    await readFile(path.join("node_modules", "@electric-sql", "pglite", "package.json"), "utf8")
  );
  console.log(
    `\nPGlite ${paquet.version} déposé dans ${DESTINATION} : ` +
      `${(brut / 1048576).toFixed(1)} Mo, ${(compresse / 1048576).toFixed(1)} Mo sur le réseau.`
  );
}

main().catch((err) => {
  console.error("Échec de l'installation de PGlite :", err.message);
  process.exit(1);
});
