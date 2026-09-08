import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it, expect, vi } from "vitest";
import request from "supertest";
import { racineProjet } from "../src/chemins";

/**
 * Ce que l'application doit faire quand sa base de données a disparu.
 *
 * Le cas s'est présenté en production : une base d'hébergeur supprimée, un
 * `getaddrinfo ENOTFOUND` au déploiement, et plus rien du tout — ni page, ni
 * sonde, ni diagnostic. Le seul retour visible était une page d'erreur de
 * l'hébergeur, alors que le projet possède une page faite exprès pour dire ce
 * qui ne va pas.
 *
 * L'exigence tient en une phrase : une base absente ne doit pas emporter avec
 * elle les moyens de le constater.
 */

/** Ce qu'un serveur DNS rend pour un nom d'hôte qui n'existe plus. */
function erreurIntrouvable(): Error & { code: string } {
  const err = new Error("getaddrinfo ENOTFOUND base-supprimee") as Error & {
    code: string;
  };
  err.code = "ENOTFOUND";
  return err;
}

// La base rejette tout, comme si elle n'existait plus. `baseInjoignable` reste
// la vraie fonction : c'est précisément elle qui est mise à l'épreuve.
vi.mock("../src/db", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/db")>()),
  pool: {
    query: vi.fn().mockRejectedValue(erreurIntrouvable()),
    executerScript: vi.fn().mockRejectedValue(erreurIntrouvable()),
    transaction: vi.fn().mockRejectedValue(erreurIntrouvable()),
    end: vi.fn(),
    on: vi.fn(),
  },
}));

// La configuration est lue à l'import : il faut une adresse de base avant, même
// si aucune connexion ne sera ouverte — le pool ci-dessus est un leurre.
process.env.DATABASE_URL ??= "postgres://essai@localhost:5432/essai";

const { createApp } = await import("../src/app");
const app = createApp();

describe("base de données injoignable", () => {
  it("garde la sonde en 200, sinon l'hébergeur rejette l'instance", async () => {
    // Tentation naturelle : rendre 503, puisque le service est dégradé. Ce
    // serait se tirer une balle dans le pied — Render n'a que cette sonde pour
    // décider si l'instance vit, et la refuserait au déploiement. On perdrait
    // du même coup le diagnostic et la reprise automatique des migrations.
    const res = await request(app).get("/health");

    expect(res.status).toBe(200);
    expect(res.body.status).toBe("degraded");
    expect(res.body.database).toBe("unreachable");
  });

  it("sert la page de diagnostic, qui est faite pour ce moment précis", async () => {
    const res = await request(app).get("/diagnostic.html");

    expect(res.status).toBe(200);
    expect(res.text).toContain("<html");
  });

  it("dit que la base manque, plutôt que « erreur interne »", async () => {
    const res = await request(app)
      .post("/api/auth/connexion")
      .set("x-outils-educsp", "1")
      .send({ email: "x@example.org", mot_de_passe: "peu-importe-1234" });

    expect(res.status).toBe(503);
    expect(res.body.error).toMatch(/base de données est injoignable/);
    expect(res.body.error).toContain("/diagnostic.html");
  });

  it("ne fait pas passer une base absente pour une session expirée", async () => {
    // Sans cela, l'utilisateur lit « Reconnectez-vous », se déconnecte, et se
    // retrouve devant un écran de connexion qui échouera tout autant.
    const res = await request(app)
      .get("/api/amorcage")
      .set("Cookie", "session_educsp=jeton-quelconque");

    expect(res.status).toBe(503);
    expect(res.body.error).not.toMatch(/Reconnectez-vous/);
  });
});

describe("séquence de démarrage", () => {
  const rendu = readFileSync(path.join(racineProjet(__dirname), "render.yaml"), "utf8");

  it("ne remet pas les migrations en préalable bloquant du serveur", () => {
    // `migrate && start` s'arrêtait au premier ordre : rien ne démarrait, et
    // la panne devenait inobservable. Le point d'entrée compilé distingue une
    // base absente — on démarre dégradé — d'une migration refusée, où l'on
    // s'arrête.
    expect(rendu).not.toMatch(/migrate:prod\s*&&/);
    expect(rendu).toContain("npm run start:prod");
  });
});
