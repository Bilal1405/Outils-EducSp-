/**
 * Recopie les migrations SQL dans un module JavaScript, pour le navigateur.
 *
 * La version pour praticien indépendant n'a pas de serveur : c'est le
 * navigateur qui applique le schéma à la base locale. Il lui faut donc le SQL,
 * et il lui faut hors ligne — une application qu'on installe sur un téléphone
 * doit pouvoir créer sa base dans le métro.
 *
 * Recopier à la main serait la garantie d'une divergence silencieuse : une
 * migration ajoutée côté serveur, oubliée côté téléphone, et deux schémas qui
 * s'écartent sans que rien ne le dise. D'où cette génération, et le contrôle
 * `test/migrationsNavigateur.test.ts` qui refuse un fichier périmé.
 *
 *   npm run generer:migrations
 */
import { readdir, readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";

const SOURCE = path.join("db", "migrations");
const DESTINATION = path.join("public", "js", "local", "migrations.js");

const ENTETE = `/**
 * Migrations du projet, pour la base locale du navigateur.
 *
 * FICHIER GÉNÉRÉ — ne pas modifier à la main.
 * Source : db/migrations/. Régénérer avec : npm run generer:migrations
 *
 * C'est le même SQL que celui appliqué au serveur PostgreSQL : les deux
 * moteurs partagent leurs migrations, jamais une version adaptée.
 */
`;

export async function construireModule() {
  const noms = (await readdir(SOURCE)).filter((n) => n.endsWith(".sql")).sort();

  const entrees = [];
  for (const nom of noms) {
    const sql = await readFile(path.join(SOURCE, nom), "utf8");
    // Un gabarit littéral supporte les apostrophes et les accents du SQL sans
    // échappement ; seuls le contre-apostrophe et `${` demandent une attention.
    const echappe = sql.replace(/\\/g, "\\\\").replace(/`/g, "\\`").replace(/\$\{/g, "\\${");
    entrees.push(`  {\n    nom: ${JSON.stringify(nom)},\n    sql: \`${echappe}\`,\n  },`);
  }

  return `${ENTETE}\nexport const MIGRATIONS = [\n${entrees.join("\n")}\n];\n`;
}

async function main() {
  const contenu = await construireModule();
  await mkdir(path.dirname(DESTINATION), { recursive: true });
  await writeFile(DESTINATION, contenu, "utf8");

  const nombre = (contenu.match(/^ {4}nom: /gm) || []).length;
  console.log(`${nombre} migrations écrites dans ${DESTINATION}.`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error("Échec de la génération :", err.message);
    process.exit(1);
  });
}
