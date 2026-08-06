import { describe, it, expect } from "vitest";
import request from "supertest";

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
  it("publie les trois listes fermées du schéma", async () => {
    const res = await request(app).get("/api/schema/bilan");

    expect(res.status).toBe(200);
    expect(res.body.domaines_competence).toEqual([...DOMAINES_COMPETENCE]);
    expect(res.body.types_comportement).toEqual([...TYPES_COMPORTEMENT]);
    expect(res.body.frequences_comportement).toEqual([...FREQUENCES_COMPORTEMENT]);
  });

  it("conserve les libellés accentués tels quels", async () => {
    const res = await request(app).get("/api/schema/bilan");

    expect(res.body.domaines_competence).toContain("Émotions et comportements");
    expect(res.body.types_comportement).toContain("Hétéro-agressivité");
    expect(res.body.frequences_comportement).toContain("1 à 10 fois par séance");
  });
});
