/**
 * Donne une identité à chaque version déployée.
 *
 * Sans elle, personne — ni l'utilisateur, ni celui qui corrige — ne peut
 * répondre à la seule question qui compte quand un défaut est signalé :
 * « quelle version tourne sur cet appareil ? ». Nous avons perdu plusieurs
 * allers-retours à corriger des choses déjà corrigées, sur des téléphones qui
 * exécutaient encore l'ancienne interface sans que rien ne le dise.
 *
 * Le tampon sert à trois choses, et c'est pourquoi il est produit une fois et
 * lu partout :
 *
 *  - il nomme le cache du service worker, qui change donc à chaque
 *    déploiement, sans constante à penser à incrémenter ;
 *  - il est servi sur `/version.json`, jamais mis en cache : c'est ce que
 *    l'appareil interroge pour savoir s'il est à jour ;
 *  - il est embarqué dans `public/js/version.js`, donc mis en cache avec
 *    l'interface : c'est la version *réellement en train de s'exécuter*.
 *
 * La comparaison des deux dit, sans ambiguïté, si l'appareil est en retard.
 *
 *   npm run generer:version
 */
import { execFileSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

/**
 * L'empreinte du commit déployé.
 *
 * Render la publie dans l'environnement ; hors de Render on la demande à git.
 * Si les deux manquent — archive téléchargée sans historique — on se rabat sur
 * l'horodatage, qui distingue au moins deux constructions successives.
 */
function empreinte() {
  const fournie = process.env.RENDER_GIT_COMMIT || process.env.GIT_COMMIT;
  if (fournie) return fournie.slice(0, 7);
  try {
    return execFileSync("git", ["rev-parse", "--short=7", "HEAD"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return "sans-git";
  }
}

export function versionCourante() {
  const construite = new Date().toISOString().replace(/\.\d+Z$/, "Z");
  // L'horodatage descend jusqu'à la seconde, et ce n'est pas de la coquetterie :
  // deux constructions du même commit le même jour — un redéploiement, ou une
  // correction essayée avant d'être validée — doivent rester distinguables.
  // Sans cela, l'appareil se croit à jour alors qu'il ne l'est pas, et l'on
  // recommence à corriger des défauts déjà corrigés.
  const horodatage = construite.slice(5, 19).replace(/[-:T]/g, "");
  return {
    // Court, lisible, et suffisant pour être comparé : c'est ce qui s'affiche
    // dans un rapport de diagnostic et se recopie dans un signalement.
    id: `${empreinte()}-${horodatage}`,
    commit: empreinte(),
    construite,
  };
}

async function main() {
  const version = versionCourante();

  await writeFile(
    path.join("public", "version.json"),
    `${JSON.stringify(version, null, 2)}\n`,
    "utf8"
  );

  await mkdir(path.join("public", "js"), { recursive: true });
  await writeFile(
    path.join("public", "js", "version.js"),
    `/**\n` +
      ` * Version de l'interface en train de s'exécuter.\n` +
      ` *\n` +
      ` * FICHIER GÉNÉRÉ — ne pas modifier à la main.\n` +
      ` * Produit par : npm run generer:version\n` +
      ` *\n` +
      ` * Mis en cache avec le reste de l'interface, donc solidaire du code\n` +
      ` * réellement chargé. Comparé à /version.json — jamais mis en cache — il\n` +
      ` * dit si l'appareil est en retard sur le serveur.\n` +
      ` */\n\n` +
      `export const VERSION = ${JSON.stringify(version, null, 2)};\n`,
    "utf8"
  );

  console.log(`Version ${version.id} (${version.construite}).`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error("Échec du tamponnage de version :", err.message);
    process.exit(1);
  });
}
