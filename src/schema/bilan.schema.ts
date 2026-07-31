import { z } from "zod";

/**
 * Schéma cible du bilan éducatif, tel que défini dans SPEC-moteur-bilan.md.
 * Les enums sont fermées : toute valeur hors liste doit être rejetée
 * (règle de génération n°5 — validation post-génération).
 */

export const DOMAINES_COMPETENCE = [
  "Autonomie vie quotidienne",
  "Prévention et traitement des comportements problèmes",
  "Émotions et comportements",
  "Communication",
  "Apprentissages scolaires/préprofessionnels",
  "Interactions sociales",
  "Activités sportives",
  "Autres",
] as const;

export const TYPES_COMPORTEMENT = [
  "Hétéro-agressivité",
  "Auto-agressivité",
  "Destructeur",
  "Perturbateur",
  "Répétitif",
  "Autres",
] as const;

export const FREQUENCES_COMPORTEMENT = [
  "Moins d'une fois par mois",
  "Moins d'une fois par semaine",
  "1 à 10 fois par séance",
  "10 à 20 fois par séance",
  "Plus de 20 fois par séance",
  "Non observé",
] as const;

export const DomaineCompetenceSchema = z.enum(DOMAINES_COMPETENCE);
export const TypeComportementSchema = z.enum(TYPES_COMPORTEMENT);
export const FrequenceComportementSchema = z.enum(FREQUENCES_COMPORTEMENT);

export const EnTeteSchema = z.object({
  structure: z.string(),
  periode_debut: z.string(),
  periode_fin: z.string(),
  beneficiaire_nom: z.string(),
  beneficiaire_age: z.number(),
  beneficiaire_date_naissance: z.string().optional().nullable(),
  beneficiaire_lieu_naissance: z.string().optional().nullable(),
  professionnels_intervenants: z.array(z.string()),
  jours_heures_intervention: z.string(),
  lieux: z.string(),
  personnes_presentes: z.string(),
  date_debut_intervention: z.string(),
});

export const ObjectifInterventionSchema = z.object({
  domaine_competence: DomaineCompetenceSchema,
  objectif: z.string(),
});

export const EvaluationComportementSchema = z.object({
  type_comportement: TypeComportementSchema,
  frequence: FrequenceComportementSchema,
});

export const EvaluationObjectifDomaineSchema = z.object({
  domaine_competence: DomaineCompetenceSchema,
  observations: z.string(),
});

export const PropositionObjectifSchema = z.object({
  domaine_competence: DomaineCompetenceSchema,
  objectif: z.string(),
  comment: z.string(),
});

export const BilanSchema = z.object({
  en_tete: EnTeteSchema,
  objectifs_intervention_periode: z.array(ObjectifInterventionSchema),
  evaluation_comportement: z.array(EvaluationComportementSchema),
  donnees_complementaires: z.string().optional().nullable(),
  evaluation_objectifs_par_domaine: z.array(EvaluationObjectifDomaineSchema),
  autres_observations: z.array(z.string()),
  proposition_objectifs_periode_suivante: z.array(PropositionObjectifSchema),
});

export type Bilan = z.infer<typeof BilanSchema>;
export type EnTete = z.infer<typeof EnTeteSchema>;
export type DomaineCompetence = z.infer<typeof DomaineCompetenceSchema>;
export type TypeComportement = z.infer<typeof TypeComportementSchema>;
export type FrequenceComportement = z.infer<typeof FrequenceComportementSchema>;
