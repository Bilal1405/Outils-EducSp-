import {
  DOMAINES_COMPETENCE,
  TYPES_COMPORTEMENT,
  FREQUENCES_COMPORTEMENT,
  type Bilan,
} from "../schema/bilan.schema";

const BILAN_JSON_SCHEMA = `{
  "en_tete": {
    "structure": "string (nom structure/PCPE)",
    "periode_debut": "date",
    "periode_fin": "date",
    "beneficiaire_nom": "string",
    "beneficiaire_age": "number",
    "beneficiaire_date_naissance": "date (optionnel, absent si non fourni en entrée)",
    "beneficiaire_lieu_naissance": "string (optionnel, absent si non fourni en entrée)",
    "professionnels_intervenants": ["string (nom + fonction)"],
    "jours_heures_intervention": "string",
    "lieux": "string",
    "personnes_presentes": "string",
    "date_debut_intervention": "date"
  },
  "objectifs_intervention_periode": [
    { "domaine_competence": "enum DOMAINE_COMPETENCE", "objectif": "string" }
  ],
  "evaluation_comportement": [
    { "type_comportement": "enum TYPE_COMPORTEMENT", "frequence": "enum FREQUENCE" }
  ],
  "donnees_complementaires": "string libre (optionnel)",
  "evaluation_objectifs_par_domaine": [
    { "domaine_competence": "enum DOMAINE_COMPETENCE", "observations": "string (paragraphe narratif)" }
  ],
  "autres_observations": ["string"],
  "proposition_objectifs_periode_suivante": [
    { "domaine_competence": "enum DOMAINE_COMPETENCE", "objectif": "string", "comment": "string (moyens/méthode envisagés)" }
  ]
}`;

/**
 * System prompt du moteur de génération de bilan.
 * Force une sortie JSON strict conforme au schéma de SPEC-moteur-bilan.md
 * et applique les règles de génération (pas d'invention, registre
 * professionnel, enums fermées).
 */
export function buildSystemPrompt(): string {
  return `Tu es le moteur de génération de bilans éducatifs trimestriels d'un \
PCPE (Pôle de Compétences et de Prestations Externalisées, secteur \
handicap/autisme). À partir du compte-rendu rédigé ou dicté par l'éducateur \
(et, si disponible, du bilan précédent du même bénéficiaire), tu produis un \
bilan structuré.

RÈGLES IMPÉRATIVES :
1. Aucune invention de donnée : n'utilise que ce qui est explicitement \
déductible de l'entrée fournie. Si une information n'est pas mentionnée, \
laisse le champ correspondant vide (chaîne vide "" ou tableau vide []) — \
ne complète jamais par supposition.
2. Continuité inter-bilans : si un bilan précédent est fourni en contexte, \
les objectifs proposés dans sa section "proposition_objectifs_periode_suivante" \
doivent être repris et évalués dans "evaluation_objectifs_par_domaine" du \
bilan courant, afin d'assurer la cohérence du suivi d'une période à l'autre.
3. Registre rédactionnel : ton professionnel, factuel, à la 3e personne, \
avec le vocabulaire du secteur médico-social (guidance, autonomie, chainage, \
comportement problème, étayage, etc.).
4. Sortie strictement JSON : réponds uniquement avec un objet JSON conforme \
au schéma ci-dessous. Aucun texte avant, après, ni en dehors de cet objet \
JSON (pas de préambule, pas de commentaire, pas de balises markdown).
5. Enums fermées : le champ "domaine_competence" doit être une valeur EXACTE \
parmi : ${DOMAINES_COMPETENCE.map((d) => `"${d}"`).join(", ")}. \
Le champ "type_comportement" doit être une valeur EXACTE parmi : \
${TYPES_COMPORTEMENT.map((t) => `"${t}"`).join(", ")}. \
Le champ "frequence" doit être une valeur EXACTE parmi : \
${FREQUENCES_COMPORTEMENT.map((f) => `"${f}"`).join(", ")}. \
N'utilise jamais une autre formulation, même proche.

SCHÉMA JSON CIBLE :
${BILAN_JSON_SCHEMA}`;
}

/**
 * Prompt utilisateur : compte-rendu de l'éducateur, et contexte du bilan
 * précédent lorsqu'il existe (règle de continuité inter-bilans).
 */
export function buildUserPrompt(inputText: string, previousBilan?: Bilan): string {
  const parts: string[] = [];

  parts.push(
    `Compte-rendu de l'éducateur pour la période concernée :\n"""\n${inputText.trim()}\n"""`
  );

  if (previousBilan) {
    parts.push(
      `Contexte du bilan précédent (période antérieure du même bénéficiaire), ` +
        `à utiliser uniquement pour assurer la continuité du suivi — les objectifs ` +
        `proposés ci-dessous doivent être évalués dans la nouvelle section ` +
        `"evaluation_objectifs_par_domaine" :\n` +
        `evaluation_objectifs_par_domaine (N-1) :\n` +
        `${JSON.stringify(previousBilan.evaluation_objectifs_par_domaine, null, 2)}\n` +
        `proposition_objectifs_periode_suivante (N-1, objectifs à évaluer maintenant) :\n` +
        `${JSON.stringify(previousBilan.proposition_objectifs_periode_suivante, null, 2)}`
    );
  }

  parts.push(
    "Génère le bilan de la période actuelle au format JSON strict défini dans le system prompt."
  );

  return parts.join("\n\n");
}
