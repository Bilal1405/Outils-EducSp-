import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it, expect } from "vitest";
import { racineProjet } from "../src/chemins";
import { contenuVierge } from "../src/schema/modeleValidation";
import { construireModule } from "../scripts/generer-schema";

/**
 * La version pour praticien indépendant n'a pas de serveur : un routeur local
 * rejoue les routes contre la base du navigateur. Deux implémentations d'une
 * même chose, donc deux occasions de diverger — et la divergence serait
 * invisible jusqu'à ce qu'un bilan ouvert sur téléphone s'avère illisible sur
 * un poste, ou l'inverse.
 *
 * Ces contrôles ne prouvent pas que le routeur fonctionne : c'est le rôle de
 * la vérification en navigateur. Ils vérifient qu'il ne s'écarte pas.
 */
const racine = racineProjet(__dirname);
const lire = (...p: string[]) => readFileSync(path.join(racine, ...p), "utf8");

describe("trames publiées au navigateur", () => {
  it("sont à jour vis-à-vis de src/schema/", () => {
    expect(
      lire("public", "js", "local", "schema.js"),
      "Les trames locales ne correspondent plus à src/schema/. " +
        "Régénérer avec : npm run generer:schema"
    ).toBe(construireModule());
  });
});

describe("contenu vierge d'un bilan", () => {
  /**
   * Le même bilan doit s'ouvrir de la même façon des deux côtés. Une zone
   * oubliée en local produirait un bilan amputé, que la validation du serveur
   * refuserait ensuite sans que le praticien comprenne pourquoi.
   */
  it.each(["repit", "trimestriel"] as const)(
    "est identique côté navigateur pour la trame %s",
    async (type) => {
      const { contenuVierge: local } = await import(
        "../public/js/local/contenuVierge.js"
      );
      expect(local(type)).toEqual(contenuVierge(type));
    }
  );
});

describe("couverture du routeur local", () => {
  const api = lire("public", "js", "api.js");
  const routeur = lire("public", "js", "local", "routeur.js");

  /**
   * Toute route appelée par l'interface doit être traitée en local — ne
   * serait-ce que pour dire qu'elle n'est pas encore disponible. Une route
   * oubliée rendrait « Route inconnue », message qui ne veut rien dire pour un
   * praticien.
   */
  it("traite toutes les routes que l'interface appelle", () => {
    const chemins = [...api.matchAll(/["'`](\/api\/[^"'`?]*)/g)]
      .map((m) => m[1])
      // Les gabarits portent `${...}` : on ne garde que le préfixe stable.
      .map((c) => c.split("$")[0])
      .filter((c) => c.length > "/api/".length);

    const uniques = [...new Set(chemins)].sort();
    expect(uniques.length).toBeGreaterThan(15);

    const absentes = uniques.filter((chemin) => {
      // Le premier segment après /api/ suffit à retrouver la famille de routes
      // dans le routeur : les identifiants variables ne s'y comparent pas.
      const segment = chemin.split("/").filter(Boolean)[1];
      return !routeur.includes(`/api\\/${segment}`);
    });

    expect(
      absentes,
      `routes non traitées par le routeur local : ${absentes.join(", ")}`
    ).toEqual([]);
  });

  it("refuse explicitement ce qu'il ne sait pas encore faire", () => {
    // Un échec silencieux ferait croire à l'utilisateur qu'il s'y prend mal.
    expect(routeur).toContain("pasEncore");
    expect(routeur).toMatch(/501/);
  });

  it("n'invente pas de quota pour un praticien seul", () => {
    // Le quota compte des bilans pour les facturer à un établissement. En
    // afficher un ici serait une limite sortie de nulle part.
    expect(routeur).toMatch(/quota: null/);
  });
});
