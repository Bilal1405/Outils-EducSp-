import { Router } from "express";
import { z } from "zod";
import { generateBilan, BilanGenerationError } from "../services/bilanGenerator";
import { getPatientById } from "../repositories/patientRepository";
import {
  getDernierBilanValide,
  creerBilanBrouillon,
  listBilansForPatient,
  getBilanById,
  getBilanAvecBeneficiaire,
  updateBilan,
} from "../repositories/bilanRepository";
import { getQuotaStatus, decrementerQuota } from "../services/quotaService";
import { schemaPourType, contenuVierge } from "../schema/modeleValidation";
import { genererBilanDocx, nomFichierBilanDocx } from "../services/bilanDocxExport";

export const bilansRouter = Router();

bilansRouter.get("/api/patients/:id/bilans", async (req, res) => {
  const bilans = await listBilansForPatient(req.params.id);
  res.json(bilans);
});

bilansRouter.get("/api/bilans/:id", async (req, res) => {
  const bilan = await getBilanById(req.params.id);
  if (!bilan) {
    return res.status(404).json({ error: "Bilan introuvable" });
  }
  res.json(bilan);
});

// Export .docx (§7) : un seul module de conversion (bilanDocxExport.ts),
// strictement fidèle au JSON validé, aucun recalcul.
bilansRouter.get("/api/bilans/:id/export.docx", async (req, res) => {
  const bilan = await getBilanAvecBeneficiaire(req.params.id);
  if (!bilan) {
    return res.status(404).json({ error: "Bilan introuvable" });
  }

  const buffer = await genererBilanDocx(bilan.type_bilan, bilan.contenu);
  const filename = nomFichierBilanDocx(
    bilan.type_bilan,
    bilan.beneficiaire,
    bilan.periode_debut,
    bilan.periode_fin
  );

  res.setHeader(
    "Content-Type",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
  );
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  return res.send(buffer);
});

const GenerateBilanBodySchema = z.object({
  texte: z.string().min(1),
  /**
   * Origine du compte-rendu, à titre de traçabilité uniquement. La dictée est
   * transcrite dans le navigateur (public/transcription.js) : le serveur ne
   * reçoit jamais d'audio et n'en écrit jamais sur disque.
   */
  source: z.enum(["texte", "audio"]).default("texte"),
  periode_debut: z.string().min(1),
  periode_fin: z.string().min(1),
});

/**
 * Ordre imposé (BRIEF_PROJET §2) : contexte N-1 → génération → validation
 * schéma → décrément quota (la transcription a lieu en amont, côté client).
 * Le quota est vérifié avant l'appel au moteur IA (alerte bloquante
 * immédiate, on n'engage pas un appel LLM voué à être gaspillé) mais n'est
 * décrémenté qu'après enregistrement réussi du bilan.
 */
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

  const patient = await getPatientById(patientId);
  if (!patient) {
    return res.status(404).json({ error: "Bénéficiaire introuvable" });
  }

  const { texte, source, periode_debut, periode_fin } = parsed.data;

  // Cas limite §2 : compte-rendu vide ou insuffisant → alerte bloquante,
  // aucune génération (BIL-04, G1, G2).
  const inputText = texte.trim();
  if (inputText.length === 0) {
    return res.status(400).json({ error: "Compte-rendu vide" });
  }

  try {
    // QUOTA-01 : blocage explicite si le quota mensuel de l'établissement
    // est épuisé — jamais de dégradation silencieuse (§4).
    const quotaAvant = await getQuotaStatus(patient.etablissement_id);
    if (!quotaAvant) {
      return res.status(500).json({ error: "Établissement introuvable pour ce patient" });
    }
    if (quotaAvant.restant <= 0) {
      return res.status(429).json({
        error: "Quota mensuel de bilans atteint pour cet établissement",
        quota: quotaAvant,
      });
    }

    const previous = await getDernierBilanValide(patientId);
    const bilan = await generateBilan(inputText, previous?.contenu);

    const saved = await creerBilanBrouillon({
      patientId,
      etablissementId: patient.etablissement_id,
      auteurId,
      typeBilan: "bilan",
      periodeDebut: periode_debut,
      periodeFin: periode_fin,
      source,
      contenu: bilan,
      bilanPrecedentId: previous?.id ?? null,
    });

    // Le décrément renvoie directement le nouvel état : pas de relecture.
    const quotaApres = await decrementerQuota(
      patient.etablissement_id,
      quotaAvant.quota_mensuel
    );

    return res.status(201).json({
      id: saved.id,
      statut: "brouillon",
      type_bilan: "bilan",
      contenu: bilan,
      quota: quotaApres,
    });
  } catch (err) {
    if (err instanceof BilanGenerationError) {
      // Alerte bloquante (§3) : sortie invalide après retry.
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

const CreerBilanBodySchema = z.object({
  /** Le type « bilan » passe par la génération, pas par cette route. */
  type: z.enum(["repit", "trimestriel"]),
  periode_debut: z.string().min(1),
  periode_fin: z.string().min(1),
});

/**
 * Ouvre un bilan à trame fixe (Répit, Trimestriel).
 *
 * Aucun appel au moteur ici : le document est rempli par l'éducateur dans un
 * parcours guidé. Le brouillon est créé d'emblée avec toutes ses clés, vides,
 * pour qu'un enregistrement partiel reste valide et qu'aucune section ne
 * disparaisse tant qu'elle n'a pas été remplie.
 *
 * Le quota est décompté à la création, comme pour un bilan généré : c'est un
 * compteur de bilans, et la règle reste la même quelle que soit la trame.
 */
bilansRouter.post("/api/patients/:id/bilans", async (req, res) => {
  const patientId = req.params.id;

  // TODO: remplacer par l'utilisateur authentifié une fois l'auth en place.
  const auteurId = req.header("x-user-id");
  if (!auteurId) {
    return res.status(401).json({ error: "Utilisateur non authentifié" });
  }

  const parsed = CreerBilanBodySchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({
      error: "Requête invalide",
      details: parsed.error.flatten(),
    });
  }

  const patient = await getPatientById(patientId);
  if (!patient) {
    return res.status(404).json({ error: "Bénéficiaire introuvable" });
  }

  const { type, periode_debut, periode_fin } = parsed.data;

  const quotaAvant = await getQuotaStatus(patient.etablissement_id);
  if (!quotaAvant) {
    return res.status(500).json({ error: "Établissement introuvable pour ce patient" });
  }
  if (quotaAvant.restant <= 0) {
    return res.status(429).json({
      error: "Quota mensuel de bilans atteint pour cet établissement",
      quota: quotaAvant,
    });
  }

  const contenu = contenuVierge(type) as Record<string, unknown>;

  const saved = await creerBilanBrouillon({
    patientId,
    etablissementId: patient.etablissement_id,
    auteurId,
    typeBilan: type,
    periodeDebut: periode_debut,
    periodeFin: periode_fin,
    // Le document n'est pas issu d'une dictée : il est saisi directement.
    // Les zones de commentaire peuvent l'être, mais pas le bilan dans son
    // ensemble.
    source: "texte",
    contenu,
  });

  const quotaApres = await decrementerQuota(
    patient.etablissement_id,
    quotaAvant.quota_mensuel
  );

  return res.status(201).json({
    id: saved.id,
    statut: "brouillon",
    type_bilan: type,
    contenu,
    periode_debut,
    periode_fin,
    quota: quotaApres,
  });
});

const UpdateBilanBodySchema = z
  .object({
    contenu: z.unknown().optional(),
    statut: z.literal("validé").optional(),
  })
  .refine((data) => data.contenu !== undefined || data.statut !== undefined, {
    message: "Fournir `contenu` et/ou `statut`",
  });

/**
 * Écran de validation/édition (BRIEF_PROJET §6) : un brouillon reste
 * modifiable ; une fois validé, le bilan est archivé définitivement et
 * cette route le refuse (409) — seule la transition brouillon → validé
 * est acceptée, jamais l'inverse.
 */
bilansRouter.patch("/api/bilans/:id", async (req, res) => {
  const parsed = UpdateBilanBodySchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({
      error: "Requête invalide",
      details: parsed.error.flatten(),
    });
  }

  const existing = await getBilanById(req.params.id);
  if (!existing) {
    return res.status(404).json({ error: "Bilan introuvable" });
  }
  if (existing.statut === "validé") {
    return res.status(409).json({
      error: "Bilan déjà validé : archivage définitif, non modifiable",
    });
  }

  // Le contenu se valide contre la trame du bilan, pas contre une trame
  // choisie par l'appelant : un contenu de répit ne peut pas être écrit dans
  // un trimestriel.
  let contenu;
  if (parsed.data.contenu !== undefined) {
    const contenuParse = schemaPourType(existing.type_bilan).safeParse(
      parsed.data.contenu
    );
    if (!contenuParse.success) {
      return res.status(400).json({
        error: `Contenu invalide pour un bilan de type « ${existing.type_bilan} »`,
        details: contenuParse.error.flatten(),
      });
    }
    contenu = contenuParse.data;
  }

  const updated = await updateBilan(req.params.id, {
    contenu,
    statut: parsed.data.statut,
  });
  return res.json(updated);
});
