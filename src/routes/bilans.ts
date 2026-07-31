import { Router } from "express";
import { z } from "zod";
import { generateBilan, BilanGenerationError } from "../services/bilanGenerator";
import { transcribeAudio } from "../services/whisperClient";
import { resolveAudioFile } from "../services/audioStorage";
import {
  getDernierBilanValide,
  creerBilanBrouillon,
} from "../repositories/bilanRepository";

export const bilansRouter = Router();

const GenerateBilanBodySchema = z
  .object({
    texte: z.string().min(1).optional(),
    audioFileId: z.string().min(1).optional(),
    periode_debut: z.string().min(1),
    periode_fin: z.string().min(1),
  })
  .refine((data) => Boolean(data.texte) || Boolean(data.audioFileId), {
    message: "Fournir soit `texte`, soit `audioFileId`",
  });

bilansRouter.post("/api/patients/:id/bilans/generate", async (req, res) => {
  const patientId = req.params.id;

  // TODO: remplacer par l'utilisateur authentifié une fois l'auth en place.
  const auteurId = req.header("x-user-id");
  if (!auteurId) {
    return res.status(401).json({ error: "Utilisateur non authentifié" });
  }

  const parsed = GenerateBilanBodySchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({
      error: "Requête invalide",
      details: parsed.error.flatten(),
    });
  }

  const { texte, audioFileId, periode_debut, periode_fin } = parsed.data;

  try {
    let inputText = texte;
    const source: "texte" | "audio" = audioFileId ? "audio" : "texte";

    if (audioFileId) {
      const audioPath = resolveAudioFile(audioFileId);
      inputText = await transcribeAudio(audioPath);
    }

    if (!inputText || inputText.trim().length === 0) {
      return res.status(400).json({
        error: "Aucun contenu exploitable (texte vide ou transcription vide)",
      });
    }

    const previousBilan = await getDernierBilanValide(patientId);
    const bilan = await generateBilan(inputText, previousBilan ?? undefined);

    const saved = await creerBilanBrouillon({
      patientId,
      auteurId,
      periodeDebut: periode_debut,
      periodeFin: periode_fin,
      source,
      contenu: bilan,
    });

    return res.status(201).json({
      id: saved.id,
      statut: "brouillon",
      contenu: bilan,
    });
  } catch (err) {
    if (err instanceof BilanGenerationError) {
      return res.status(502).json({
        error: "Échec de génération du bilan",
        details: err.message,
      });
    }
    // eslint-disable-next-line no-console
    console.error(err);
    return res.status(500).json({ error: "Erreur interne" });
  }
});
