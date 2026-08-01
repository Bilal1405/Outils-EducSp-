import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { config } from "../src/config";
import { transcribeAudio } from "../src/services/whisperClient";

vi.mock("node:fs", async () => {
  const { Readable } = await import("node:stream");
  return {
    createReadStream: vi.fn(() => Readable.from([Buffer.from("fake-audio")])),
  };
});

describe("transcribeAudio", () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    global.fetch = vi.fn();
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("appelle l'endpoint OpenAI-compatible /v1/audio/transcriptions du serveur Whisper", async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce(
      new Response(JSON.stringify({ text: "bonjour le monde" }), {
        status: 200,
      })
    );

    const texte = await transcribeAudio("/tmp/audio.webm");

    expect(texte).toBe("bonjour le monde");
    const [calledUrl] = vi.mocked(global.fetch).mock.calls[0];
    expect(calledUrl).toBe(`${config.whisper.baseUrl}/v1/audio/transcriptions`);
  });

  it("lève une erreur explicite si le serveur Whisper répond en erreur", async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce(
      new Response("modèle non chargé", { status: 500, statusText: "Internal Server Error" })
    );

    await expect(transcribeAudio("/tmp/audio.webm")).rejects.toThrow(
      /Appel Whisper échoué/
    );
  });
});
