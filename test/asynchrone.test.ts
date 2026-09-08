import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import express from "express";
import request from "supertest";
import { describe, it, expect, vi } from "vitest";
import { creerRouteur } from "../src/routeurAsync";
import { racineProjet } from "../src/chemins";

/**
 * Ce que ces contrôles protègent : un rejet de promesse dans un gestionnaire
 * de route ne doit pas terminer le processus. Express 4 n'attend pas les
 * gestionnaires `async` — sans précaution, une base momentanément injoignable
 * fait tomber l'application entière, et avec elle le travail en cours de tous
 * les utilisateurs connectés, au lieu de rendre une seule requête en erreur.
 */
function applicationDeTest() {
  const routeur = creerRouteur();

  routeur.get("/echoue-en-async", async () => {
    throw new Error("base injoignable");
  });
  routeur.get("/echoue-apres-attente", async () => {
    await new Promise((resoudre) => setTimeout(resoudre, 1));
    throw new Error("base injoignable plus tard");
  });
  routeur.get("/echoue-en-sync", () => {
    throw new Error("erreur synchrone");
  });
  routeur.get("/repond", (_req, res) => res.json({ ok: true }));

  const app = express();
  app.use(routeur);
  app.use(
    (
      _err: unknown,
      _req: express.Request,
      res: express.Response,
      _next: express.NextFunction
    ) => res.status(500).json({ error: "Erreur interne" })
  );
  return app;
}

describe("gestionnaires asynchrones", () => {
  it.each([
    ["un rejet immédiat", "/echoue-en-async"],
    ["un rejet après une attente", "/echoue-apres-attente"],
    ["une exception synchrone", "/echoue-en-sync"],
  ])("transforme %s en 500", async (_libelle, route) => {
    const res = await request(applicationDeTest()).get(route);

    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: "Erreur interne" });
  });

  it("ne laisse passer aucun rejet non capté", async () => {
    const surveillant = vi.fn();
    process.on("unhandledRejection", surveillant);

    await request(applicationDeTest()).get("/echoue-apres-attente");
    // Laisser au moteur le temps de signaler un rejet qui serait resté orphelin.
    await new Promise((resoudre) => setTimeout(resoudre, 20));

    process.off("unhandledRejection", surveillant);
    expect(surveillant).not.toHaveBeenCalled();
  });

  it("n'altère pas une route qui répond normalement", async () => {
    const res = await request(applicationDeTest()).get("/repond");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
  });

  /**
   * La protection est au niveau du routeur : elle ne vaut que si les fichiers
   * de routes l'utilisent. Un `Router()` d'Express oublié dans un nouveau
   * fichier rétablirait le défaut, sans que rien d'autre ne le signale.
   */
  it("est employée par tous les fichiers de routes", () => {
    const dossier = path.join(racineProjet(__dirname), "src", "routes");

    const fautifs = readdirSync(dossier)
      .filter((nom) => nom.endsWith(".ts"))
      .filter((nom) => /(?<![a-zA-Z])Router\(\)/.test(readFileSync(path.join(dossier, nom), "utf8")));

    expect(
      fautifs,
      `Ces fichiers créent un routeur Express sans protection : ${fautifs.join(", ")}. ` +
        `Utiliser creerRouteur() (src/routeurAsync.ts).`
    ).toEqual([]);
  });
});
