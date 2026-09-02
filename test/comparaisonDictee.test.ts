import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it, expect } from "vitest";
import { racineProjet } from "../src/chemins";

/**
 * La page de comparaison des précisions doit rester fidèle à ce qu'elle
 * prétend mesurer.
 *
 * Son seul intérêt est de faire tourner *exactement* la dictée de
 * l'application, à la précision près. Si elle se met à appeler Whisper avec
 * d'autres réglages, ou un autre modèle, elle continuera d'afficher deux
 * colonnes et un écart — mais l'écart ne dira plus rien de l'outil.
 */
const racine = racineProjet(__dirname);
const lire = (...morceaux: string[]) =>
  readFileSync(path.join(racine, ...morceaux), "utf8");

describe("comparaison des précisions de dictée", () => {
  const module = lire("public", "js", "comparaison.js");
  const page = lire("public", "comparaison-dictee.html");

  it("ne pilote que des éléments qui existent dans la page", () => {
    const identifiants = [...module.matchAll(/\$\("([^"]+)"\)/g)].map((m) => m[1]);

    expect(identifiants.length).toBeGreaterThan(5);
    const absents = identifiants.filter((id) => !page.includes(`id="${id}"`));
    expect(absents, `identifiants absents de la page : ${absents.join(", ")}`).toEqual([]);
  });

  it("emprunte modèle et réglages à la dictée, au lieu de les recopier", () => {
    // Recopier « fr », « chunk_length_s: 30 » ou le nom du dépôt ici, c'est
    // accepter qu'ils divergent un jour sans que rien ne le signale.
    expect(module).toMatch(/from "\/transcription\.js"/);
    expect(module).toContain("OPTIONS_TRANSCRIPTION");
    expect(module).toContain("MODELE");
    expect(module).not.toMatch(/chunk_length_s/);
    expect(module).not.toMatch(/onnx-community\//);
  });

  it("compare bien la variante en service à la variante quantifiée", () => {
    // `dtype: undefined` n'est pas un oubli : c'est ce que fait l'application.
    // L'écrire « fp32 » comparerait deux choix explicites, dont l'un n'est pas
    // celui qui tourne.
    expect(module).toMatch(/dtype:\s*undefined/);
    expect(module).toMatch(/dtype:\s*"q8"/);
  });

  it("n'envoie l'audio nulle part", () => {
    // La promesse de la dictée — l'audio ne quitte pas le poste — vaut ici
    // aussi, et une page d'évaluation est justement l'endroit où l'on serait
    // tenté d'« envoyer l'échantillon pour analyse ».
    expect(module).not.toMatch(/fetch\(|XMLHttpRequest|navigator\.sendBeacon/);
  });
});
