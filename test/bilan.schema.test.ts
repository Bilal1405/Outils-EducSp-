import { describe, it, expect } from "vitest";
import { BilanSchema } from "../src/schema/bilan.schema";
import { validBilanFixture } from "./fixtures/bilanFixture";

describe("BilanSchema", () => {
  it("valide un bilan conforme au schéma", () => {
    expect(BilanSchema.safeParse(validBilanFixture).success).toBe(true);
  });

  it("rejette un domaine_competence hors enum", () => {
    const invalid = {
      ...validBilanFixture,
      objectifs_intervention_periode: [
        { domaine_competence: "Domaine inventé", objectif: "x" },
      ],
    };
    expect(BilanSchema.safeParse(invalid).success).toBe(false);
  });

  it("rejette une frequence hors enum", () => {
    const invalid = {
      ...validBilanFixture,
      evaluation_comportement: [
        { type_comportement: "Répétitif", frequence: "tous les jours" },
      ],
    };
    expect(BilanSchema.safeParse(invalid).success).toBe(false);
  });

  it("accepte l'absence de date/lieu de naissance (champs optionnels)", () => {
    const { beneficiaire_date_naissance, beneficiaire_lieu_naissance, ...rest } =
      validBilanFixture.en_tete;
    const withoutOptionalFields = { ...validBilanFixture, en_tete: rest };
    expect(BilanSchema.safeParse(withoutOptionalFields).success).toBe(true);
  });
});
