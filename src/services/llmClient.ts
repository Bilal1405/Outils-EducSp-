import { config } from "../config";
import { ollamaChat, type ChatMessage } from "./ollamaClient";
import { cerebrasChat } from "./cerebrasClient";

export type { ChatMessage };

/**
 * Point d'entrée unique du moteur vers le LLM, quel que soit le fournisseur
 * configuré (`LLM_PROVIDER`). `bilanGenerator.ts` ne dépend que de cette
 * abstraction, jamais directement d'un client de fournisseur particulier.
 */
export async function chatComplete(messages: ChatMessage[]): Promise<string> {
  if (config.llmProvider === "ollama") {
    return ollamaChat(messages);
  }
  return cerebrasChat(messages);
}
