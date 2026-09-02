import { chatComplete } from "./llmClient";
import {
  REFORMULATION_SYSTEM_PROMPT,
  construireMessageReformulation,
} from "../prompts/reformulationPrompt";

export class ReformulationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ReformulationError";
  }
}

/** Au-delà, on refuse : une zone de commentaire n'est pas un compte-rendu. */
const LONGUEUR_MAX = 5000;

/**
 * Le modèle a tendance à encadrer sa réponse de guillemets ou d'un bloc de
 * code malgré la consigne. On les retire, mais uniquement s'ils enveloppent
 * l'intégralité du texte : des guillemets internes appartiennent au propos de
 * l'éducateur.
 */
function nettoyer(brut: string): string {
  let texte = brut.trim();

  const blocCode = texte.match(/^```(?:\w+)?\n([\s\S]*?)\n?```$/);
  if (blocCode) {
    texte = blocCode[1].trim();
  }

  const paires: [string, string][] = [
    ['"', '"'],
    ["«", "»"],
    ["“", "”"],
  ];
  for (const [ouvrant, fermant] of paires) {
    if (texte.startsWith(ouvrant) && texte.endsWith(fermant) && texte.length > 1) {
      const interieur = texte.slice(ouvrant.length, -fermant.length);
      if (!interieur.includes(fermant)) {
        texte = interieur.trim();
      }
    }
  }

  return texte;
}

/**
 * Met au propre un commentaire dicté.
 *
 * Le texte source est renvoyé tel quel dans deux cas : s'il est vide, et si le
 * moteur répond une chaîne vide. Jamais de valeur inventée, jamais de perte
 * silencieuse du texte d'origine — c'est l'éducateur qui décide ensuite de
 * garder la reformulation ou de revenir en arrière, l'interface conservant la
 * version initiale.
 */
export async function reformulerCommentaire(
  texte: string,
  intitule?: string
): Promise<string> {
  const source = texte.trim();
  if (source === "") {
    return texte;
  }
  if (source.length > LONGUEUR_MAX) {
    throw new ReformulationError(
      `Texte trop long pour une reformulation (${source.length} caractères, maximum ${LONGUEUR_MAX}).`
    );
  }

  const brut = await chatComplete([
    { role: "system", content: REFORMULATION_SYSTEM_PROMPT },
    { role: "user", content: construireMessageReformulation(source, intitule) },
  ]);

  const reformule = nettoyer(brut);
  return reformule === "" ? texte : reformule;
}
