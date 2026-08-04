import { config } from "../config";
import type { ChatMessage } from "./ollamaClient";

/**
 * Appelle l'API Cerebras (cloud.cerebras.ai, compatible format OpenAI) et
 * retourne le contenu texte brut de la réponse du modèle. Utilisée à la
 * place d'Ollama pour des temps de réponse nettement plus rapides.
 */
export async function cerebrasChat(messages: ChatMessage[]): Promise<string> {
  // Le serveur refuse déjà de démarrer sans clé (validerConfigurationDemarrage) ;
  // ce garde-fou couvre les scripts qui appellent le client directement, comme
  // `npm run validate:corpus`.
  if (!config.cerebras.apiKey) {
    throw new Error(
      "CEREBRAS_API_KEY manquante : renseignez-la dans .env (clé gratuite sur cloud.cerebras.ai)"
    );
  }

  const response = await fetch(`${config.cerebras.baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.cerebras.apiKey}`,
    },
    body: JSON.stringify({
      model: config.cerebras.model,
      messages,
      temperature: 0.2,
    }),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(
      `Appel Cerebras échoué (${response.status} ${response.statusText}): ${body}`
    );
  }

  const data = (await response.json()) as {
    choices?: { message?: { content?: string } }[];
  };
  const content = data.choices?.[0]?.message?.content;
  if (!content) {
    throw new Error("Réponse Cerebras sans contenu de message");
  }
  return content;
}
