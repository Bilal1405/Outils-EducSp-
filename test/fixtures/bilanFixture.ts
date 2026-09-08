import type { Bilan } from "../../src/schema/bilan.schema";

/** Bilan fictif conforme au schéma, utilisé uniquement dans les tests. */
export const validBilanFixture: Bilan = {
  en_tete: {
    structure: "PCPE Fictif 75",
    periode_debut: "2024-01-01",
    periode_fin: "2024-03-31",
    beneficiaire_nom: "Bénéficiaire Fictif",
    beneficiaire_age: 10,
    beneficiaire_date_naissance: null,
    beneficiaire_lieu_naissance: null,
    professionnels_intervenants: ["Camille Dupont, éducatrice spécialisée"],
    jours_heures_intervention: "Lundis et jeudis, 14h-16h",
    lieux: "Domicile",
    personnes_presentes: "Mère du bénéficiaire",
    date_debut_intervention: "2023-09-01",
  },
  objectifs_intervention_periode: [
    {
      domaine_competence: "Autonomie vie quotidienne",
      objectif: "Renforcer l'usage des couverts en autonomie",
    },
  ],
  evaluation_comportement: [
    {
      type_comportement: "Répétitif",
      frequence: "Moins d'une fois par semaine",
    },
  ],
  donnees_complementaires: "",
  evaluation_objectifs_par_domaine: [
    {
      domaine_competence: "Autonomie vie quotidienne",
      observations:
        "Le bénéficiaire a progressé sur l'usage des couverts avec une guidance physique réduite.",
    },
  ],
  autres_observations: [],
  proposition_objectifs_periode_suivante: [
    {
      domaine_competence: "Autonomie vie quotidienne",
      objectif: "Travailler l'habillage en autonomie",
      comment: "Guidance verbale dégressive sur les séances à venir",
    },
  ],
};
