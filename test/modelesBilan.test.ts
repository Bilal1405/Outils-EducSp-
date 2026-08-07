import { describe, it, expect } from "vitest";
import {
  MODELES,
  blocsDuModele,
  type BlocBilan,
  type ModeleBilan,
} from "../src/schema/modelesBilan";
import {
  contenuVierge,
  schemaPourType,
  RepitSchema,
  TrimestrielSchema,
} from "../src/schema/modeleValidation";

const modeles: [string, ModeleBilan][] = Object.entries(MODELES);

/**
 * La trame décrit à la fois le formulaire, la validation et l'export. Une
 * incohérence à l'intérieur (deux blocs de même clé, une échelle absente) ne
 * se verrait qu'à l'usage, sur un bilan déjà commencé.
 */
describe.each(modeles)("trame %s", (_nom, modele) => {
  it("n'a aucune clé de bloc en double", () => {
    const cles = blocsDuModele(modele).map((bloc) => bloc.cle);
    expect(new Set(cles).size).toBe(cles.length);
  });

  it("ne référence que des échelles définies", () => {
    const manquantes = blocsDuModele(modele)
      .filter((bloc): bloc is Extract<BlocBilan, { type: "tableau" }> => bloc.type === "tableau")
      .filter((bloc) => !modele.echelles[bloc.echelle])
      .map((bloc) => `${bloc.cle} → ${bloc.echelle}`);
    expect(manquantes).toEqual([]);
  });

  it("n'a aucune étape vide", () => {
    expect(modele.etapes.filter((etape) => etape.blocs.length === 0)).toEqual([]);
  });

  it("produit un contenu vierge valide", () => {
    const vierge = contenuVierge(modele.type);
    expect(schemaPourType(modele.type).safeParse(vierge).success).toBe(true);
  });

  it("expose dans le contenu vierge exactement les clés de la trame", () => {
    const vierge = contenuVierge(modele.type) as Record<string, unknown>;
    expect(Object.keys(vierge).sort()).toEqual(
      blocsDuModele(modele)
        .map((bloc) => bloc.cle)
        .sort()
    );
  });
});

describe("validation des trames", () => {
  it("accepte une ligne non cotée : l'absence d'observation est un état légitime", () => {
    const contenu = contenuVierge("repit") as Record<string, Record<string, string>>;
    contenu.socialisation_pairs.reste_a_cote = "Souvent";
    // Les autres lignes restent à "" et doivent le rester.
    expect(RepitSchema.safeParse(contenu).success).toBe(true);
  });

  it("refuse une cotation hors de l'échelle du document", () => {
    const contenu = contenuVierge("repit") as Record<string, Record<string, string>>;
    contenu.socialisation_pairs.reste_a_cote = "De temps en temps";
    expect(RepitSchema.safeParse(contenu).success).toBe(false);
  });

  it("refuse un type de comportement absent du document", () => {
    const contenu = contenuVierge("trimestriel") as Record<string, unknown>;
    contenu.comportements_problemes = [
      { type: "Bavardage", intensite: "Légère", frequence: "", commentaire: "" },
    ];
    expect(TrimestrielSchema.safeParse(contenu).success).toBe(false);
  });

  it("n'accepte pas le contenu d'une trame dans l'autre", () => {
    expect(TrimestrielSchema.safeParse(contenuVierge("repit")).success).toBe(false);
    expect(RepitSchema.safeParse(contenuVierge("trimestriel")).success).toBe(false);
  });
});

describe("découpage en étapes", () => {
  /**
   * Contrainte d'usage : une étape doit tenir dans une hauteur d'écran, sans
   * défilement. La hauteur réelle se mesure en navigateur ; ce test borde le
   * seul paramètre qui la fait déraper, et sa limite est calibrée sur cette
   * mesure — huit lignes est la plus grosse grille vérifiée comme tenant en
   * 1366×768, commentaire compris. Au-delà, il faut scinder l'étape et
   * remesurer.
   */
  const LIGNES_MAX_PAR_ETAPE = 8;

  it("ne dépasse pas la taille de grille mesurée comme tenant dans un écran", () => {
    const trop: string[] = [];
    for (const [, modele] of modeles) {
      for (const etape of modele.etapes) {
        const lignes = etape.blocs
          .filter((bloc): bloc is Extract<BlocBilan, { type: "tableau" }> => bloc.type === "tableau")
          .reduce((total, bloc) => total + bloc.lignes.length, 0);
        if (lignes > LIGNES_MAX_PAR_ETAPE) {
          trop.push(`${modele.type}/${etape.cle} : ${lignes} lignes`);
        }
      }
    }
    expect(trop).toEqual([]);
  });
});
