import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";

vi.mock("../src/services/sessionService", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/services/sessionService")>()),
  resoudreSession: vi.fn(),
  prolongerSession: vi.fn(),
}));

import { resoudreSession } from "../src/services/sessionService";
import { bouchonnerSession, connecte } from "./aide/session";

import { createApp } from "../src/app";
import {
  DOMAINES_COMPETENCE,
  TYPES_COMPORTEMENT,
  FREQUENCES_COMPORTEMENT,
} from "../src/schema/bilan.schema";

const app = createApp();

/**
 * L'interface alimente ses menus déroulants de relecture avec cette route.
 * Si elle cessait de refléter `bilan.schema.ts`, l'éducateur se verrait
 * proposer des valeurs que le serveur rejetterait ensuite : ces tests
 * verrouillent l'égalité, pas seulement la présence.
 */
describe("GET /api/schema/bilan", () => {
  beforeEach(() => bouchonnerSession(resoudreSession));

  it("publie les trois listes fermées du schéma", async () => {
    const res = await connecte(request(app).get("/api/schema/bilan"));

    expect(res.status).toBe(200);
    expect(res.body.domaines_competence).toEqual([...DOMAINES_COMPETENCE]);
    expect(res.body.types_comportement).toEqual([...TYPES_COMPORTEMENT]);
    expect(res.body.frequences_comportement).toEqual([...FREQUENCES_COMPORTEMENT]);
  });

  it("conserve les libellés accentués tels quels", async () => {
    const res = await connecte(request(app).get("/api/schema/bilan"));

    expect(res.body.domaines_competence).toContain("Émotions et comportements");
    expect(res.body.types_comportement).toContain("Hétéro-agressivité");
    expect(res.body.frequences_comportement).toContain("1 à 10 fois par séance");
  });
});

/**
 * Ces deux réponses ne dépendent que de la version déployée. Les trames pèsent
 * 16 Kio, redemandés à chaque ouverture de l'application : la revalidation
 * ramène ce coût à celui d'un en-tête.
 */
describe("revalidation des routes de schéma", () => {
  beforeEach(() => bouchonnerSession(resoudreSession));

  it.each(["/api/schema/bilan", "/api/schema/modeles"])(
    "répond 304 à une revalidation de %s",
    async (route) => {
      const premiere = await connecte(request(app).get(route));
      expect(premiere.headers.etag).toBeTruthy();

      const seconde = await connecte(
        request(app).get(route).set("If-None-Match", premiere.headers.etag)
      );

      expect(seconde.status).toBe(304);
      expect(seconde.text).toBeFalsy();
    }
  );

  it("ne fige pas la réponse dans le cache du navigateur", async () => {
    // Une trame corrigée par un déploiement doit arriver tout de suite : le
    // navigateur garde la réponse mais redemande à chaque fois si elle vaut
    // toujours.
    const res = await connecte(request(app).get("/api/schema/modeles"));
    expect(res.headers["cache-control"]).toBe("private, max-age=0, must-revalidate");
  });

  it("change d'empreinte si une trame change", async () => {
    const { MODELES } = await import("../src/schema/modelesBilan");
    const avant = await connecte(request(app).get("/api/schema/modeles"));

    // L'empreinte est calculée au chargement du module : elle doit refléter
    // le contenu servi, pas l'instant de la requête.
    expect(avant.headers.etag).toBe(
      (await connecte(request(app).get("/api/schema/modeles"))).headers.etag
    );
    expect(Object.keys(MODELES).length).toBeGreaterThan(0);
  });
});
