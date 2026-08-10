import "dotenv/config";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { racineProjet } from "../src/chemins";
import { Pool } from "pg";

const MIGRATIONS_DIR = path.join(racineProjet(__dirname), "db", "migrations");

async function main() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });

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
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(sql);
      await client.query("INSERT INTO schema_migrations (name) VALUES ($1)", [
        file,
      ]);
      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  }

  await pool.end();
  console.log("Migrations terminées.");
}

main().catch((err) => {
  console.error("Échec des migrations:", err);
  process.exit(1);
});
