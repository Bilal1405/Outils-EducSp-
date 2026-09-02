import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it, expect } from "vitest";
import { racineProjet } from "../src/chemins";

/**
 * L'écran de préparation n'a pas de rendu à lui : il pilote un balisage écrit
 * dans `index.html`. Renommer un identifiant d'un côté et pas de l'autre ne
 * casse rien de visible — `$("…")` rend `null`, l'exception part dans la
 * console, et l'écran ne s'affiche jamais. On s'en apercevrait le jour où un
 * éducateur attend son texte, c'est-à-dire trop tard.
 */
const racine = racineProjet(__dirname);
const lire = (...morceaux: string[]) =>
  readFileSync(path.join(racine, ...morceaux), "utf8");

describe("écran de préparation", () => {
  const module = lire("public", "js", "preparation.js");
  const page = lire("public", "index.html");

  it("ne pilote que des éléments qui existent dans la page", () => {
    const identifiants = [...module.matchAll(/\$\("([^"]+)"\)/g)].map((m) => m[1]);

    expect(identifiants.length).toBeGreaterThan(5);
    const absents = identifiants.filter((id) => !page.includes(`id="${id}"`));
    expect(absents, `identifiants absents d'index.html : ${absents.join(", ")}`).toEqual([]);
  });

  it("est lancé au démarrage, après la connexion", () => {
    const app = lire("public", "js", "app.js");
    expect(app).toContain('import { preparerOutil } from "./preparation.js"');
    expect(app).toContain("preparerOutil()");
  });

  it("laisse toujours une sortie", () => {
    // Un poste sans accès à huggingface.co doit rester capable d'écrire au
    // clavier. Sans ces deux boutons, l'écran deviendrait une impasse.
    expect(page).toContain('id="preparation-passer"');
    expect(page).toContain('id="preparation-continuer"');
  });

  it("charge la transcription après la session, pas avant", () => {
    // Un `modulepreload` de `/transcription.js` la ferait chercher dès
    // l'ouverture de la page, y compris par un visiteur non connecté.
    expect(page).not.toMatch(/modulepreload"\s+href="\/transcription\.js"/);
  });
});
