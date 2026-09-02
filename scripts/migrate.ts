import "dotenv/config";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { racineProjet } from "../src/chemins";
// Le même accès que l'application : les migrations doivent s'appliquer aussi
// bien à un serveur PostgreSQL qu'à la base embarquée, sans script séparé.
import { embarquee, dossierBaseEmbarquee, pool } from "../src/db";

const MIGRATIONS_DIR = path.join(racineProjet(__dirname), "db", "migrations");

/**
 * Codes d'erreur qui désignent une base qu'on n'a pas pu joindre, par
 * opposition à une migration qui échoue sur son SQL. Les premiers valent la
 * peine d'être réessayés — une base d'hébergeur peut mettre un moment à se
 * réveiller — les seconds jamais.
 */
const INJOIGNABLE = ["ENOTFOUND", "ECONNREFUSED", "ETIMEDOUT", "EAI_AGAIN"];

function estInjoignable(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    INJOIGNABLE.includes(String((err as { code?: string }).code))
  );
}

/**
 * Traduit une base injoignable en quelque chose d'actionnable.
 *
 * Le message brut — `getaddrinfo ENOTFOUND dpg-xxxx-a` — s'affiche dans les
 * journaux d'un hébergeur, au milieu d'un redémarrage en boucle, et ne dit ni
 * ce qui manque ni où regarder. Il y a pourtant peu de causes possibles, et
 * elles se vérifient en une minute chacune.
 */
function expliquerInjoignable(err: { code?: string; hostname?: string }): string {
  const hote = err.hostname ? `« ${err.hostname} »` : "l'adresse configurée";

  if (err.code === "ENOTFOUND" || err.code === "EAI_AGAIN") {
    return (
      `La base de données est introuvable : le nom ${hote} ne se résout pas.\n` +
      "Ce n'est pas une panne de l'application — elle n'a pas de base à laquelle parler.\n\n" +
      "Trois causes, par ordre de fréquence :\n" +
      "  1. la base n'existe plus (une base gratuite est supprimée au bout de\n" +
      "     30 jours) — il faut en créer une neuve et restaurer une sauvegarde ;\n" +
      "  2. DATABASE_URL désigne une base supprimée ou renommée : comparez-la à\n" +
      "     la chaîne de connexion affichée sur la page de la base ;\n" +
      "  3. la base et le service ne sont pas dans la même région : un nom\n" +
      "     d'hôte interne ne se résout qu'à l'intérieur d'une région.\n\n" +
      "Tant que ce point n'est pas réglé, aucun déploiement ne peut aboutir."
    );
  }
  return (
    `La base de données ne répond pas (${err.code}) sur ${hote}.\n` +
    "Elle est peut-être arrêtée, en cours de démarrage, ou refuse les\n" +
    "connexions extérieures. Vérifiez son état, puis relancez le déploiement."
  );
}

/**
 * Attend que la base réponde, avant d'entreprendre quoi que ce soit.
 *
 * Une base d'hébergeur peut mettre un moment à se réveiller, et le
 * déploiement démarre parfois avant elle. Cinq tentatives espacées valent
 * mieux qu'un redémarrage en boucle du service entier — mais elles ne servent
 * qu'à absorber une lenteur : au bout du compte, une base absente reste une
 * base absente, et il faut le dire clairement plutôt que réessayer sans fin.
 */
async function attendreLaBase(): Promise<void> {
  const ATTENTES_MS = [0, 2000, 5000, 10000, 20000];

  for (const [essai, attente] of ATTENTES_MS.entries()) {
    if (attente > 0) {
      console.log(
        `Base injoignable, nouvelle tentative dans ${attente / 1000} s ` +
          `(${essai + 1}/${ATTENTES_MS.length})…`
      );
      await new Promise((resoudre) => setTimeout(resoudre, attente));
    }
    try {
      await pool.query("SELECT 1");
      return;
    } catch (err) {
      if (!estInjoignable(err) || essai === ATTENTES_MS.length - 1) {
        throw err;
      }
    }
  }
}

async function main() {
  if (embarquee) {
    console.log(`Base embarquée : ${dossierBaseEmbarquee()}`);
  }

  await attendreLaBase();

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
  if (estInjoignable(err)) {
    // Le message brut — `getaddrinfo ENOTFOUND dpg-xxxx-a` — s'affiche dans
    // les journaux d'un hébergeur au milieu d'un redémarrage en boucle, et ne
    // dit ni ce qui manque ni où regarder.
    console.error(`\n${expliquerInjoignable(err as { code?: string; hostname?: string })}\n`);
  } else {
    console.error("Échec des migrations:", err);
  }
  process.exit(1);
});
