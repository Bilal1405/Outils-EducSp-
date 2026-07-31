import "dotenv/config";

function required(name: string, fallback?: string): string {
  const value = process.env[name] ?? fallback;
  if (value === undefined) {
    throw new Error(`Variable d'environnement manquante: ${name}`);
  }
  return value;
}

export type LlmProvider = "cerebras" | "ollama";

export const config = {
  port: Number(process.env.PORT ?? 3000),
  databaseUrl: required("DATABASE_URL"),
  llmProvider: (process.env.LLM_PROVIDER ?? "cerebras") as LlmProvider,
  cerebras: {
    baseUrl: process.env.CEREBRAS_BASE_URL ?? "https://api.cerebras.ai/v1",
    apiKey: process.env.CEREBRAS_API_KEY ?? "",
    model: process.env.CEREBRAS_MODEL ?? "gpt-oss-120b",
  },
  ollama: {
    baseUrl: process.env.OLLAMA_BASE_URL ?? "http://localhost:11434",
    model: process.env.OLLAMA_MODEL ?? "llama3.1",
  },
  whisper: {
    baseUrl: process.env.WHISPER_BASE_URL ?? "http://localhost:9000",
  },
  audioUploadsDir: process.env.AUDIO_UPLOADS_DIR ?? "./uploads/audio",
};
