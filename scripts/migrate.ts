import "dotenv/config";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { racineProjet } from "../src/chemins";
// Le même accès que l'application : les migrations doivent s'appliquer aussi
// bien à un serveur PostgreSQL qu'à la base embarquée, sans script séparé.
import { embarquee, dossierBaseEmbarquee, pool } from "../src/db";

const MIGRATIONS_DIR = path.join(racineProjet(__dirname), "db", "migrations");

async function main() {
  if (embarquee) {
    console.log(`Base embarquée : ${dossierBaseEmbarquee()}`);
  }

  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      name TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);

  const files = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort();

  for (const file of files) {
    const { rows } = await pool.query(
      "SELECT 1 FROM schema_migrations WHERE name = $1",
      [file]
    );
    if (rows.length > 0) {
      console.log(`- ${file} déjà appliquée, ignorée`);
      continue;
    }

    const sql = readFileSync(path.join(MIGRATIONS_DIR, file), "utf-8");
    console.log(`> application de ${file}...`);
    await pool.transaction(async (base) => {
      await base.executerScript(sql);
      await base.query("INSERT INTO schema_migrations (name) VALUES ($1)", [file]);
    });
  }

  await pool.end();
  console.log("Migrations terminées.");
}

main().catch((err) => {
  console.error("Échec des migrations:", err);
  process.exit(1);
});
