import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

/**
 * Le choix du fournisseur LLM est un point de sortie de données de santé :
 * une valeur non reconnue ne doit jamais retomber silencieusement sur une API
 * tierce. Ces tests verrouillent ce comportement.
 */
describe("config — fournisseur LLM", () => {
  const envInitial = { ...process.env };

  beforeEach(() => {
    vi.resetModules();
    process.env.DATABASE_URL = "postgres://localhost:5432/test";
  });

  afterEach(() => {
    process.env = { ...envInitial };
  });

  async function chargerConfig() {
    return (await import("../src/config")).config;
  }

  it("retient Cerebras par défaut quand la variable est absente", async () => {
    delete process.env.LLM_PROVIDER;
    expect((await chargerConfig()).llmProvider).toBe("cerebras");
  });

  it("accepte les valeurs connues, casse et espaces compris", async () => {
    process.env.LLM_PROVIDER = "  Ollama ";
    expect((await chargerConfig()).llmProvider).toBe("ollama");
  });

  it("refuse de démarrer sur une faute de frappe plutôt que de basculer sur Cerebras", async () => {
    process.env.LLM_PROVIDER = "olama";
    await expect(chargerConfig()).rejects.toThrow(/LLM_PROVIDER invalide/);
  });

  it("exige la clé Cerebras au démarrage quand ce fournisseur est actif", async () => {
    process.env.LLM_PROVIDER = "cerebras";
    delete process.env.CEREBRAS_API_KEY;
    const { validerConfigurationDemarrage } = await import("../src/config");
    expect(() => validerConfigurationDemarrage()).toThrow(/CEREBRAS_API_KEY/);
  });

  it("n'exige aucune clé Cerebras lorsque le moteur tourne en local", async () => {
    process.env.LLM_PROVIDER = "ollama";
    delete process.env.CEREBRAS_API_KEY;
    const { validerConfigurationDemarrage } = await import("../src/config");
    expect(() => validerConfigurationDemarrage()).not.toThrow();
  });
});
