import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, it, expect } from "vitest";
import { racineProjet } from "../src/chemins";

/**
 * L'application installée sur un téléphone n'a pas de serveur à joindre : sa
 * base est sur l'appareil. Tout ce qui la rend installable et utilisable hors
 * réseau tient dans trois fichiers — le manifeste, le service worker, les
 * icônes — et leurs défauts sont silencieux : une ressource mal nommée dans la
 * liste de préchargement ne casse rien à l'écran, elle ne se voit que le jour
 * où un praticien ouvre l'application dans un endroit sans réseau.
 */
const racine = racineProjet(__dirname);
const lire = (...p: string[]) => readFileSync(path.join(racine, ...p), "utf8");
const existe = (...p: string[]) => existsSync(path.join(racine, ...p));

describe("manifeste de l'application", () => {
  const manifeste = JSON.parse(lire("public", "manifeste.webmanifest"));

  it("démarre sur la base de l'appareil", () => {
    // Sans `?local=1`, l'application installée chercherait un serveur — et un
    // praticien indépendant n'en a pas.
    expect(manifeste.start_url).toBe("/?local=1");
    expect(manifeste.display).toBe("standalone");
  });

  it("porte les icônes qu'Android exige pour installer", () => {
    const tailles = manifeste.icons.map((i: { sizes: string }) => i.sizes);
    expect(tailles).toContain("192x192");
    expect(tailles).toContain("512x512");
    expect(
      manifeste.icons.some((i: { purpose?: string }) => i.purpose === "maskable"),
      "sans icône rognable, Android découpe le dessin n'importe comment"
    ).toBe(true);
  });

  it("ne référence que des icônes qui existent", () => {
    for (const icone of manifeste.icons as { src: string }[]) {
      expect(existe("public", ...icone.src.split("/").filter(Boolean)), icone.src).toBe(true);
    }
  });
});

describe("service worker", () => {
  const sw = lire("public", "sw.js");

  /**
   * `cache.add` échoue en silence sur une ressource absente — c'est délibéré,
   * pour qu'une erreur de chemin ne rende pas l'application non installable.
   * Le prix est qu'elle ne se verrait qu'hors réseau : d'où ce contrôle.
   */
  it("ne précharge que des fichiers qui existent", () => {
    const liste = sw
      .slice(sw.indexOf("const PRECACHE"), sw.indexOf("];", sw.indexOf("const PRECACHE")))
      .match(/"([^"]+)"/g)!
      .map((s) => s.slice(1, -1));

    expect(liste.length).toBeGreaterThan(15);
    const absents = liste.filter(
      (chemin) => chemin !== "/" && !existe("public", ...chemin.split("/").filter(Boolean))
    );
    expect(absents, `fichiers préchargés mais absents : ${absents.join(", ")}`).toEqual([]);
  });

  it("précharge tous les modules que la page annonce", () => {
    // Un module chargé au démarrage mais absent du cache ferait échouer
    // l'ouverture hors réseau, à l'endroit le moins prévisible.
    const page = lire("public", "index.html");
    const annonces = [...page.matchAll(/modulepreload"\s+href="([^"]+)"/g)].map((m) => m[1]);
    expect(annonces.length).toBeGreaterThan(10);
    const oublies = annonces.filter((chemin) => !sw.includes(`"${chemin}"`));
    expect(oublies, `modules non mis en cache : ${oublies.join(", ")}`).toEqual([]);
  });

  it("ne met jamais de donnée de santé en cache", () => {
    // Une réponse d'API périmée montrerait un dossier qui n'est plus à jour.
    expect(sw).toMatch(/pathname\.startsWith\("\/api\/"\)/);
  });
});

describe("page d'accueil", () => {
  const page = lire("public", "index.html");

  it("déclare le manifeste et la couleur de barre système", () => {
    expect(page).toContain('rel="manifest" href="/manifeste.webmanifest"');
    expect(page).toMatch(/name="theme-color"/);
  });

  it("propose l'installation sans passer par une boutique", () => {
    expect(page).toContain('id="installer-valider"');
    expect(page).toContain('id="installer-plus-tard"');
  });
});
