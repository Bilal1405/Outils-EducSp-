import crypto from "node:crypto";
import fs from "node:fs/promises";
import express, { Router } from "express";
import { config } from "../config";
import { resolveAudioFile } from "../services/audioStorage";
import { transcribeAudio } from "../services/whisperClient";

export const audioRouter = Router();

/**
 * Extensions supportées côté MediaRecorder navigateur. `resolveAudioFile`
 * sécurise déjà le chemin via path.basename ; l'extension ne sert qu'à aider
 * le service Whisper à déterminer le format si besoin.
 */
const EXTENSION_PAR_CONTENT_TYPE: Record<string, string> = {
  "audio/webm": "webm",
  "audio/ogg": "ogg",
  "audio/mp4": "m4a",
  "audio/mpeg": "mp3",
  "audio/wav": "wav",
};

audioRouter.post(
  "/api/audio",
  express.raw({
    type: Object.keys(EXTENSION_PAR_CONTENT_TYPE),
    limit: "25mb",
  }),
  async (req, res) => {
    if (!Buffer.isBuffer(req.body) || req.body.length === 0) {
      return res.status(400).json({
        error:
          "Corps audio manquant ou Content-Type non supporté (audio/webm, audio/ogg, audio/mp4, audio/mpeg, audio/wav)",
      });
    }

    const contentType = req.get("content-type")?.split(";")[0]?.trim() ?? "";
    const extension = EXTENSION_PAR_CONTENT_TYPE[contentType] ?? "webm";
    const audioFileId = `${crypto.randomUUID()}.${extension}`;

    await fs.mkdir(config.audioUploadsDir, { recursive: true });
    await fs.writeFile(resolveAudioFile(audioFileId), req.body);

    return res.status(201).json({ audioFileId });
  }
);

audioRouter.post("/api/audio/:audioFileId/transcribe", async (req, res) => {
  try {
    const audioPath = resolveAudioFile(req.params.audioFileId);
    const texte = await transcribeAudio(audioPath);
    return res.json({ texte });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error(err);
    return res.status(502).json({
      error: "Échec de la transcription",
      details: err instanceof Error ? err.message : String(err),
    });
  }
});
