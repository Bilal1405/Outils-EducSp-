import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it, expect } from "vitest";
import { racineProjet } from "../src/chemins";

/**
 * Une sauvegarde circule : elle est téléchargée, copiée sur une clé, envoyée
 * par courriel. Ce qu'elle contient n'est donc pas seulement une question de
 * complétude, mais de ce qu'on accepte de laisser sortir.
 *
 * Le contrôle porte sur la requête elle-même plutôt que sur son résultat : une
 * colonne ajoutée par mégarde au `SELECT` échapperait à un test qui se
 * contenterait d'inspecter un objet bouchonné.
 */
const service = readFileSync(
  path.join(racineProjet(__dirname), "src", "services", "sauvegardeService.ts"),
  "utf8"
);

describe("contenu d'une sauvegarde", () => {
  it("n'emporte aucune empreinte de mot de passe", () => {
    // Même robuste, une empreinte offre à qui met la main sur le fichier le
    // loisir de l'attaquer hors ligne. Après restauration, les comptes
    // existent mais leur mot de passe est à redéfinir — un bilan est
    // irremplaçable, un mot de passe se recrée en une minute.
    expect(service).not.toMatch(/mot_de_passe/);
  });

  it("borne chaque lecture à l'établissement demandé", () => {
    // Sans quoi une sauvegarde emporterait les dossiers des autres structures.
    const requetes = service.match(/FROM (\w+)/g) ?? [];
    expect(requetes.length).toBeGreaterThan(4);

    const sansFiltre = service
      .split("pool.query(")
      .slice(1)
      .filter((bloc) => !bloc.includes("etablissement_id = $1") && !bloc.includes("WHERE id = $1"));

    expect(sansFiltre, "une requête de sauvegarde ne filtre pas sur l'établissement").toEqual([]);
  });

  it("porte un numéro de version, pour que le script de restauration refuse ce qu'il ne sait pas lire", () => {
    expect(service).toMatch(/VERSION_SAUVEGARDE = \d+/);
  });
});

describe("script de restauration", () => {
  const script = readFileSync(
    path.join(racineProjet(__dirname), "scripts", "restaurer-sauvegarde.mjs"),
    "utf8"
  );

  it("refuse d'écrire par-dessus une base qui contient des dossiers", () => {
    // Une restauration par erreur sur une base en service serait pire que la
    // panne qu'elle prétend réparer.
    expect(script).toContain("--forcer");
    expect(script).toMatch(/FROM patients/);
  });

  it("ne compte pas l'établissement semé par la migration comme une donnée", () => {
    // Une base fraîchement migrée en contient déjà un : s'y arrêter refuserait
    // précisément la base sur laquelle on veut restaurer.
    expect(script).not.toMatch(/count\(\*\)::int AS n FROM etablissements/);
  });

  it("travaille dans une transaction", () => {
    expect(script).toContain("BEGIN");
    expect(script).toContain("ROLLBACK");
  });
});
