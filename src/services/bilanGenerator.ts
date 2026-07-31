import { ZodError } from "zod";
import { BilanSchema, type Bilan } from "../schema/bilan.schema";
import { buildSystemPrompt, buildUserPrompt } from "../prompts/bilanPrompt";
import { chatComplete, type ChatMessage } from "./llmClient";

export class BilanGenerationError extends Error {
  constructor(message: string, public readonly cause?: unknown) {
    super(message);
    this.name = "BilanGenerationError";
  }
}

function extractJson(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) {
      throw new Error("Réponse du moteur non parsable en JSON");
    }
    return JSON.parse(match[0]);
  }
}

/**
 * Génère un bilan structuré à partir du compte-rendu de l'éducateur.
 * Si `previousBilan` est fourni, il est injecté comme contexte de suivi
 * (règle de continuité inter-bilans).
 *
 * Effectue un unique retry si la réponse n'est pas un JSON valide, ou si
 * elle ne respecte pas le schéma (notamment les enums fermées de
 * `domaine_competence` / `type_comportement` / `frequence`).
 */
export async function generateBilan(
  inputText: string,
  previousBilan?: Bilan
): Promise<Bilan> {
  const messages: ChatMessage[] = [
    { role: "system", content: buildSystemPrompt() },
    { role: "user", content: buildUserPrompt(inputText, previousBilan) },
  ];

  const maxAttempts = 2;
  let lastError: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const raw = await chatComplete(messages);
      const parsed = extractJson(raw);
      const result = BilanSchema.safeParse(parsed);

      if (result.success) {
        return result.data;
      }

      lastError = result.error;
      if (attempt < maxAttempts) {
        messages.push({ role: "assistant", content: raw });
        messages.push({
          role: "user",
          content: buildValidationRetryMessage(result.error),
        });
      }
    } catch (err) {
      lastError = err;
      if (attempt < maxAttempts) {
        messages.push({
          role: "user",
          content:
            "La réponse précédente n'était pas un JSON valide. Renvoie " +
            "uniquement un objet JSON valide conforme au schéma, sans " +
            "aucun texte en dehors du JSON.",
        });
      }
    }
  }

  throw new BilanGenerationError(
    "Échec de génération du bilan après retry",
    lastError
  );
}

function buildValidationRetryMessage(error: ZodError): string {
  const issues = error.issues
    .map((issue) => `- ${issue.path.join(".")}: ${issue.message}`)
    .join("\n");
  return (
    "La réponse précédente ne respecte pas le schéma JSON attendu. " +
    "Erreurs de validation :\n" +
    issues +
    "\n\nCorrige et renvoie uniquement un objet JSON valide, conforme au " +
    "schéma et aux enums fermées (aucune autre valeur ni formulation " +
    "n'est acceptée pour domaine_competence, type_comportement et frequence)."
  );
}
