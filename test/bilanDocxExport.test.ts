import { describe, it, expect } from "vitest";
import { genererBilanDocx, nomFichierBilanDocx } from "../src/services/bilanDocxExport";
import { validBilanFixture } from "./fixtures/bilanFixture";

describe("genererBilanDocx", () => {
  it("produit un buffer .docx valide (signature ZIP)", async () => {
    const buffer = await genererBilanDocx("bilan", validBilanFixture);
    expect(buffer.length).toBeGreaterThan(0);
    // Un .docx est une archive ZIP (signature "PK").
    expect(buffer[0]).toBe(0x50);
    expect(buffer[1]).toBe(0x4b);
  });
});

describe("nomFichierBilanDocx", () => {
  it("respecte le nommage imposé (§7)", () => {
    expect(nomFichierBilanDocx("bilan", "Alice Dupont", "2024-01-01", "2024-03-31")).toBe(
      "Bilan_Alice_Dupont_2024_01_01_2024_03_31.docx"
    );
  });

  it("retire les accents pour un nom de fichier sûr", () => {
    expect(nomFichierBilanDocx("trimestriel", "Léo Bénéficiaire", "2024-01-01", "2024-03-31")).toBe(
      "Bilan_trimestriel_Leo_Beneficiaire_2024_01_01_2024_03_31.docx"
    );
  });
});
