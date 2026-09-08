import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { describe, it, expect } from "vitest";
import { racineProjet } from "../src/chemins";

/**
 * Le mécanisme de mise à jour est ce dont tout le reste dépend.
 *
 * Tant qu'il ne fonctionnait pas, une correction poussée pouvait rester
 * plusieurs jours sans atteindre l'appareil qui l'avait demandée — et nous
 * avons corrigé à plusieurs reprises des défauts déjà corrigés, faute de
 * pouvoir seulement savoir quelle version s'exécutait.
 *
 * Ces contrôles portent sur ce qui rendait la panne invisible : une identité
 * qui ne change pas, une liste écrite à la main, un fichier de version mis en
 * cache, et un recours qui effaçait les dossiers.
 */
const racine = racineProjet(__dirname);
const lire = (...p: string[]) => readFileSync(path.join(racine, ...p), "utf8");

describe("identité d'une version", () => {
  it("change à chaque construction, même sans nouveau commit", async () => {
    const { versionCourante } = await import("../scripts/generer-version.mjs");
    const a = versionCourante();
    // Deux constructions du même commit doivent rester distinguables : un
    // redéploiement, ou une correction essayée avant d'être validée.
    expect(a.id).toMatch(/^\S+-\d{10}$/);
    expect(a.id).toContain(a.commit);
  });

  it("est publiée sans jamais pouvoir être mise en cache", () => {
    const app = lire("src", "app.ts");
    expect(app).toContain('app.get("/version.json"');
    expect(app).toMatch(/Cache-Control", "no-store/);

    // Et le service worker doit la laisser passer : servie depuis son cache,
    // elle affirmerait que l'appareil est à jour quel que soit le déploiement.
    const sw = lire("public", "sw.modele.js");
    expect(sw).toMatch(/pathname === "\/version\.json"/);
  });

  it("n'est plus celle de package.json, qui ne bougeait jamais", async () => {
    // Contrôle du comportement, et non de l'ordre des lignes : c'est ce que
    // le serveur *répond* qui compte.
    if (!existsSync(path.join(racine, "public", "version.json"))) return;

    process.env.DATABASE_URL ??= "postgres://essai@localhost:5432/essai";
    const request = (await import("supertest")).default;
    const { createApp } = await import("../src/app");

    const attendu = JSON.parse(lire("public", "version.json")).id;
    const res = await request(createApp()).get("/version.json");

    expect(res.status).toBe(200);
    expect(res.body.id).toBe(attendu);
    expect(res.headers["cache-control"]).toBe("no-store");
  });
});

describe("service worker", () => {
  const modele = lire("public", "sw.modele.js");

  it("est produit, pas écrit à la main", () => {
    expect(modele).toContain("__VERSION__");
    expect(modele).toContain("__PRECACHE__");
    expect(existsSync(path.join(racine, "public", "sw.js"))).toBe(
      existsSync(path.join(racine, "public", "version.json"))
    );
  });

  it("porte la version dans le nom de son cache", () => {
    // Tant que c'était une constante à incrémenter, un déploiement pouvait
    // laisser ce fichier identique : le navigateur ne voyait alors aucune mise
    // à jour, et l'appareil gardait l'ancienne interface.
    expect(modele).toMatch(/const VERSION = "__VERSION__"/);
    expect(modele).toMatch(/educsp-\$\{VERSION\}/);
  });

  it("relève lui-même les fichiers à mettre en cache", async () => {
    const { construireServiceWorker } = await import("../scripts/generer-sw.mjs");
    if (!existsSync(path.join(racine, "public", "version.json"))) return;

    const produit: string = await construireServiceWorker();
    const listes = produit
      .slice(produit.indexOf("const PRECACHE"), produit.indexOf("];"))
      .match(/"([^"]+)"/g)!
      .map((s) => s.slice(1, -1));

    // Les modules annoncés par la page doivent tous s'y trouver : un module
    // chargé au démarrage mais absent du cache ferait échouer l'ouverture hors
    // réseau, à l'endroit le moins prévisible.
    const page = lire("public", "index.html");
    const annonces = [...page.matchAll(/modulepreload"\s+href="([^"]+)"/g)].map((m) => m[1]);
    const oublies = annonces.filter((chemin) => !listes.includes(chemin));
    expect(oublies, `modules non mis en cache : ${oublies.join(", ")}`).toEqual([]);

    // Et rien de ce qui n'a pas à y être.
    expect(listes.some((c) => c.startsWith("/vendor/"))).toBe(false);
    expect(listes).not.toContain("/version.json");
    expect(listes).not.toContain("/sw.js");
  });
});

describe("appliquer une mise à jour", () => {
  const pwa = lire("public", "js", "pwa.js");

  it("attend la relève du service worker avant de recharger", () => {
    // Recharger tout de suite ne suffisait pas : le rechargement était encore
    // servi par l'ancien service worker, donc par l'ancienne interface. Il
    // fallait fermer et rouvrir une seconde fois — ce que personne ne devine.
    expect(pwa).toContain("controllerchange");
    expect(pwa).toMatch(/enregistrement\.update\(\)/);
  });

  it("compare aussi les versions, sans dépendre du service worker", () => {
    // Deux mécanismes qui échouent différemment valent mieux qu'un seul.
    expect(pwa).toContain("verifierLaVersion");
    expect(pwa).toMatch(/fetch\("\/version\.json", \{ cache: "no-store" \}\)/);
  });

  it("ne touche jamais aux dossiers pour rafraîchir l'interface", () => {
    // La manœuvre connue jusqu'ici — « effacer les données du site » — effaçait
    // aussi la base. On ne fait pas perdre des données de santé pour
    // rafraîchir un fichier JavaScript.
    const recours = pwa.slice(pwa.indexOf("export async function repartirDeZero"));
    expect(recours).toContain('nom.startsWith("educsp-")');
    expect(recours).not.toMatch(/indexedDB|deleteDatabase|transformers-cache"\)/);
  });
});
