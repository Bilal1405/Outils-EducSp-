import { config } from "../config";

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

/**
 * Appelle l'API chat d'Ollama (self-hosted) et retourne le contenu texte
 * brut de la réponse du modèle. `format: "json"` force Ollama à produire
 * un JSON syntaxiquement valide (le respect du schéma métier reste à
 * valider côté applicatif, cf. src/services/bilanGenerator.ts).
 */
export async function ollamaChat(messages: ChatMessage[]): Promise<string> {
  const response = await fetch(`${config.ollama.baseUrl}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: config.ollama.model,
      messages,
      format: "json",
      stream: false,
      options: { temperature: 0.2 },
    }),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(
      `Appel Ollama échoué (${response.status} ${response.statusText}): ${body}`
    );
  }

  const data = (await response.json()) as { message?: { content?: string } };
  const content = data.message?.content;
  if (!content) {
    throw new Error("Réponse Ollama sans contenu de message");
  }
  return content;
}
