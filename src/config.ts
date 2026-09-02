import "dotenv/config";

function required(name: string, fallback?: string): string {
  const value = process.env[name] ?? fallback;
  if (value === undefined) {
    throw new Error(`Variable d'environnement manquante: ${name}`);
  }
  return value;
}

export const LLM_PROVIDERS = ["cerebras", "ollama"] as const;
export type LlmProvider = (typeof LLM_PROVIDERS)[number];

/**
 * Détermine le fournisseur LLM actif.
 *
 * Aucune tolérance sur la valeur : un simple `LLM_PROVIDER=olama` ne doit
 * jamais retomber silencieusement sur Cerebras. Le contrat du projet est
 * qu'aucune donnée patient ne sort de l'infrastructure — une faute de frappe
 * qui bascule d'un modèle local vers une API tierce serait une fuite de
 * données de santé, sans le moindre message d'erreur. On refuse donc de
 * démarrer plutôt que de deviner.
 */
function resolveLlmProvider(): LlmProvider {
  const brut = process.env.LLM_PROVIDER;
  if (brut === undefined || brut.trim() === "") {
    return "cerebras";
  }

  const valeur = brut.trim().toLowerCase();
  if (!(LLM_PROVIDERS as readonly string[]).includes(valeur)) {
    throw new Error(
      `LLM_PROVIDER invalide: "${brut}". Valeurs acceptées: ` +
        `${LLM_PROVIDERS.join(", ")}. Démarrage interrompu — corrigez la ` +
        `variable plutôt que de laisser le choix du fournisseur au hasard.`
    );
  }
  return valeur as LlmProvider;
}

export const config = {
  port: Number(process.env.PORT ?? 3000),
  /**
   * Décide notamment si le cookie de session exige HTTPS. En production ce
   * doit être `production` — sinon le cookie voyagerait en clair.
   */
  env: process.env.NODE_ENV ?? "development",
  databaseUrl: required("DATABASE_URL"),
  llmProvider: resolveLlmProvider(),
  cerebras: {
    baseUrl: process.env.CEREBRAS_BASE_URL ?? "https://api.cerebras.ai/v1",
    apiKey: process.env.CEREBRAS_API_KEY ?? "",
    model: process.env.CEREBRAS_MODEL ?? "gpt-oss-120b",
  },
  ollama: {
    baseUrl: process.env.OLLAMA_BASE_URL ?? "http://localhost:11434",
    model: process.env.OLLAMA_MODEL ?? "llama3.1",
  },
};

/**
 * Contrôles qui n'ont de sens qu'au lancement d'un vrai serveur — appelée
 * depuis server.ts, pas à l'import du module, pour que les tests puissent
 * charger la configuration sans exiger les secrets de production.
 *
 * Objectif : échouer au démarrage plutôt qu'au milieu d'une génération, quand
 * un éducateur attend son bilan.
 */
export function validerConfigurationDemarrage(): void {
  if (config.llmProvider === "cerebras" && !config.cerebras.apiKey) {
    throw new Error(
      "CEREBRAS_API_KEY manquante alors que LLM_PROVIDER=cerebras. " +
        "Renseignez-la (clé gratuite sur cloud.cerebras.ai) ou basculez sur " +
        "LLM_PROVIDER=ollama."
    );
  }
}
