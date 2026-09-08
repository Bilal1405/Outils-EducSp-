import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { describe, it, expect } from "vitest";
import { racineProjet } from "../src/chemins";

/**
 * Le navigateur applique lui-même le schéma, à partir d'une copie générée des
 * migrations. Deux copies, donc deux occasions de diverger — et la divergence
 * serait silencieuse : le serveur continuerait de fonctionner pendant que la
 * base des praticiens resterait en arrière d'une version, jusqu'à ce qu'une
 * requête cherche une colonne qui n'existe pas chez eux.
 *
 * Ce contrôle refuse un fichier périmé. Il ne remplace pas la génération : il
 * l'exige.
 */
const racine = racineProjet(__dirname);
const GENERE = path.join(racine, "public", "js", "local", "migrations.js");

describe("migrations embarquées dans le navigateur", () => {
  it("est à jour vis-à-vis de db/migrations/", async () => {
    expect(
      existsSync(GENERE),
      "public/js/local/migrations.js est absent. Générer avec : npm run generer:migrations"
    ).toBe(true);

    const { construireModule } = await import("../scripts/generer-migrations.mjs");
    const attendu = await construireModule();

    expect(
      readFileSync(GENERE, "utf8"),
      "Les migrations du navigateur ne correspondent plus à db/migrations/. " +
        "Régénérer avec : npm run generer:migrations"
    ).toBe(attendu);
  });

  it("porte les mêmes migrations que le serveur, dans le même ordre", async () => {
    const contenu = readFileSync(GENERE, "utf8");
    const noms = [...contenu.matchAll(/^ {4}nom: "([^"]+)"/gm)].map((m) => m[1]);
    const { readdirSync } = await import("node:fs");
    const attendus = readdirSync(path.join(racine, "db", "migrations"))
      .filter((n) => n.endsWith(".sql"))
      .sort();

    expect(noms).toEqual(attendus);
  });

  it("n'adapte aucune migration au passage", async () => {
    // Le SQL est recopié tel quel : c'est toute la promesse. Une variante
    // « pour le navigateur » ferait diverger les deux schémas sans que rien ne
    // le dise, et la base embarquée du serveur ne la couvrirait pas.
    const contenu = readFileSync(GENERE, "utf8");
    const { readdirSync } = await import("node:fs");
    const dossier = path.join(racine, "db", "migrations");

    for (const nom of readdirSync(dossier).filter((n) => n.endsWith(".sql"))) {
      const lignes = readFileSync(path.join(dossier, nom), "utf8")
        .split("\n")
        .map((l) => l.trim())
        .filter((l) => l.length > 20 && !l.startsWith("--"));
      expect(lignes.length, `${nom} paraît vide`).toBeGreaterThan(0);
      expect(contenu, `${nom} n'est pas repris tel quel`).toContain(lignes[0]);
    }
  });
});
