import { createReadStream } from "node:fs";
import { config } from "../config";

/**
 * Transcrit un fichier audio via un service Whisper self-hosted exposant
 * l'API OpenAI-compatible `/v1/audio/transcriptions` (ex: speaches,
 * anciennement faster-whisper-server).
 */
export async function transcribeAudio(audioFilePath: string): Promise<string> {
  const form = new FormData();
  const stream = createReadStream(audioFilePath);
  form.append("file", new Blob([await streamToBuffer(stream)]), "audio");
  form.append("model", config.whisper.model);

  const response = await fetch(`${config.whisper.baseUrl}/v1/audio/transcriptions`, {
    method: "POST",
    body: form,
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(
      `Appel Whisper échoué (${response.status} ${response.statusText}): ${body}`
    );
  }

  const data = (await response.json()) as { text?: string };
  if (!data.text) {
    throw new Error("Réponse Whisper sans transcription");
  }
  return data.text;
}

async function streamToBuffer(stream: NodeJS.ReadableStream): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}
