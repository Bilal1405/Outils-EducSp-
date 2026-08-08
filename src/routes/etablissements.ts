import { Router } from "express";
import { z } from "zod";
import {
  getEtablissementById,
  mettreAJourEtablissement,
} from "../repositories/etablissementRepository";
import { getQuotaStatus } from "../services/quotaService";
import { listerAudit } from "../services/auditService";
import { etablissementDe, exigerRole } from "../middleware/authentification";

export const etablissementsRouter = Router();

/**
 * Un utilisateur ne voit que son établissement.
 *
 * La route listait auparavant tous les établissements de la base, et
 * permettait à quiconque d'en créer un. La création relève désormais de
 * l'initialisation de l'instance (`/api/auth/initialisation`) : ouvrir un
 * nouvel établissement depuis l'interface reviendrait à créer un locataire
 * supplémentaire sans contrepartie ni contrôle.
 */
etablissementsRouter.get("/api/etablissement", async (req, res) => {
  const etablissement = await getEtablissementById(etablissementDe(req));
  if (!etablissement) {
    return res.status(404).json({ error: "Établissement introuvable" });
  }
  return res.json(etablissement);
});

etablissementsRouter.get("/api/etablissement/quota", async (req, res) => {
  const quota = await getQuotaStatus(etablissementDe(req));
  if (!quota) {
    return res.status(404).json({ error: "Établissement introuvable" });
  }
  return res.json(quota);
});

const MajEtablissementSchema = z.object({
  nom: z.string().min(1).optional(),
  adresse: z.string().optional(),
  telephone: z.string().optional(),
  email: z.string().optional(),
  quota_mensuel_bilans: z.number().int().positive().optional(),
});

/**
 * Coordonnées de la structure, reprises dans l'en-tête des documents exportés.
 * Réservé au coordinateur : elles engagent l'établissement sur des documents
 * transmis à des familles et à des partenaires.
 */
etablissementsRouter.patch(
  "/api/etablissement",
  exigerRole("coordinateur"),
  async (req, res) => {
    const parsed = MajEtablissementSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        error: "Requête invalide",
        details: parsed.error.flatten(),
      });
    }

    const misAJour = await mettreAJourEtablissement(etablissementDe(req), parsed.data);
    if (!misAJour) {
      return res.status(404).json({ error: "Établissement introuvable" });
    }
    return res.json(misAJour);
  }
);

/**
 * Journal d'audit de l'établissement. Réservé au coordinateur : savoir qui a
 * consulté quel dossier est une information sensible en soi.
 */
etablissementsRouter.get(
  "/api/etablissement/audit",
  exigerRole("coordinateur"),
  async (req, res) => {
    const limite = Number(req.query.limite ?? 200);
    res.json(
      await listerAudit(
        etablissementDe(req),
        Number.isFinite(limite) ? limite : 200
      )
    );
  }
);
