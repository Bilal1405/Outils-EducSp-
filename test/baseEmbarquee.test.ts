import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, it, expect, beforeAll } from "vitest";
import { racineProjet } from "../src/chemins";

/**
 * La base embarquée doit rester le *même* PostgreSQL.
 *
 * Tout l'intérêt de PGlite ici est qu'aucune requête n'a été réécrite pour
 * lui : les migrations, les `ON CONFLICT`, les colonnes JSONB et les `::int`
 * du projet passent tels quels. Cette promesse ne tient que si elle est
 * vérifiée — une requête écrite pour un serveur PostgreSQL et refusée par la
 * base embarquée ne se verrait autrement qu'au moment d'installer l'outil
 * chez quelqu'un.
 *
 * Le paquet est optionnel : un déploiement d'établissement n'en a pas besoin.
 * Ces contrôles s'effacent donc là où il n'est pas installé, plutôt que de
 * faire échouer une suite de tests pour une dépendance qu'on a choisi de ne
 * pas imposer.
 */
let PGlite: typeof import("@electric-sql/pglite").PGlite | null = null;

beforeAll(async () => {
  try {
    ({ PGlite } = await import("@electric-sql/pglite"));
  } catch {
    PGlite = null;
  }
});

const migrations = () => {
  const dossier = path.join(racineProjet(__dirname), "db", "migrations");
  return readdirSync(dossier)
    .filter((nom) => nom.endsWith(".sql"))
    .sort()
    .map((nom) => ({ nom, sql: readFileSync(path.join(dossier, nom), "utf8") }));
};

describe("base embarquée", () => {
  it("applique toutes les migrations du projet, sans en adapter aucune", async () => {
    if (!PGlite) return;
    const base = await PGlite.create("memory://");

    const echecs: string[] = [];
    for (const { nom, sql } of migrations()) {
      try {
        await base.exec(sql);
      } catch (err) {
        echecs.push(`${nom} : ${(err as Error).message.split("\n")[0]}`);
      }
    }

    expect(echecs, `migrations refusées par la base embarquée :\n${echecs.join("\n")}`).toEqual([]);
    await base.close();
  });

  it("exécute les requêtes caractéristiques du projet", async () => {
    if (!PGlite) return;
    const base = await PGlite.create("memory://");
    for (const { sql } of migrations()) {
      await base.exec(sql);
    }

    // Un identifiant produit par la base : c'est ce qui exigeait pgcrypto,
    // devenu inutile depuis PostgreSQL 13.
    const etab = await base.query<{ id: string }>(
      `INSERT INTO etablissements (nom) VALUES ($1) RETURNING id`,
      ["PCPE Essai"]
    );
    expect(etab.rows[0].id).toMatch(/^[0-9a-f-]{36}$/);
    const etablissementId = etab.rows[0].id;

    // Le recensement de la mise en service : agrégat, jointure externe, cast.
    await base.query(
      `INSERT INTO patients (nom, prenom, etablissement_id) VALUES ($1, $2, $3)`,
      ["Martin", "Lou", etablissementId]
    );
    const recensement = await base.query<{ nombre_beneficiaires: number }>(
      `SELECT COUNT(p.id)::int AS nombre_beneficiaires
         FROM etablissements e LEFT JOIN patients p ON p.etablissement_id = e.id
        GROUP BY e.id`
    );
    expect(recensement.rows[0].nombre_beneficiaires).toBe(1);

    // Le quota : un upsert, exactement celui de quotaService.
    const quota = await base.query<{ bilans_generes: number }>(
      `INSERT INTO quota_usage (etablissement_id, mois, bilans_generes)
       VALUES ($1, date_trunc('month', now())::date, 1)
       ON CONFLICT (etablissement_id, mois)
       DO UPDATE SET bilans_generes = quota_usage.bilans_generes + 1
       RETURNING bilans_generes`,
      [etablissementId]
    );
    expect(quota.rows[0].bilans_generes).toBe(1);

    // Le contenu d'un bilan est du JSONB, et doit revenir tel qu'il est parti.
    const contenu = { synthese: "Texte accentué : évaluation à mi-parcours." };
    await base.query(
      `INSERT INTO audit_logs (action, etablissement_id, details)
       VALUES ('connexion', $1, $2)`,
      [etablissementId, JSON.stringify(contenu)]
    );
    const relu = await base.query<{ details: { synthese: string } }>(
      `SELECT details FROM audit_logs WHERE etablissement_id = $1`,
      [etablissementId]
    );
    expect(relu.rows[0].details.synthese).toBe(contenu.synthese);

    await base.close();
  });

  it("garde les dates telles que PostgreSQL les écrit", async () => {
    if (!PGlite) return;
    // Sans ce réglage, une date revient en `Date` locale et le jour se décale
    // d'une unité une fois reconvertie en ISO.
    const base = await PGlite.create("memory://", {
      parsers: { 1082: (valeur: string) => valeur },
    });
    for (const { sql } of migrations()) {
      await base.exec(sql);
    }

    const etab = await base.query<{ id: string }>(
      `INSERT INTO etablissements (nom) VALUES ('X') RETURNING id`
    );
    await base.query(
      `INSERT INTO patients (nom, prenom, date_naissance, etablissement_id)
       VALUES ('Martin', 'Lou', $1, $2)`,
      ["2015-04-12", etab.rows[0].id]
    );
    const { rows } = await base.query<{ date_naissance: string }>(
      `SELECT date_naissance FROM patients`
    );

    expect(rows[0].date_naissance).toBe("2015-04-12");
    await base.close();
  });
});
