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
  // Aiguillage exhaustif volontaire (pas de `else` fourre-tout) : ajouter un
  // fournisseur sans l'implémenter ici devient une erreur de compilation, et
  // non un repli silencieux sur une API tierce.
  switch (config.llmProvider) {
    case "ollama":
      return ollamaChat(messages);
    case "cerebras":
      return cerebrasChat(messages);
    default: {
      const jamais: never = config.llmProvider;
      throw new Error(`Fournisseur LLM non géré: ${jamais}`);
    }
  }
}
