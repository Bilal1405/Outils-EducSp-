import { Router } from "express";
import { z } from "zod";
import {
  listEtablissements,
  creerEtablissement,
} from "../repositories/etablissementRepository";
import { getQuotaStatus } from "../services/quotaService";

export const etablissementsRouter = Router();

etablissementsRouter.get("/api/etablissements", async (_req, res) => {
  const etablissements = await listEtablissements();
  res.json(etablissements);
});

const CreerEtablissementSchema = z.object({
  nom: z.string().min(1),
  quota_mensuel_bilans: z.number().int().positive().optional(),
});

etablissementsRouter.post("/api/etablissements", async (req, res) => {
  const parsed = CreerEtablissementSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({
      error: "Requête invalide",
      details: parsed.error.flatten(),
    });
  }

  const created = await creerEtablissement(
    parsed.data.nom,
    parsed.data.quota_mensuel_bilans
  );
  return res.status(201).json(created);
});

// Quota visible en permanence côté UI (BRIEF_PROJET §6).
etablissementsRouter.get("/api/etablissements/:id/quota", async (req, res) => {
  const quota = await getQuotaStatus(req.params.id);
  if (!quota) {
    return res.status(404).json({ error: "Établissement introuvable" });
  }
  return res.json(quota);
});
