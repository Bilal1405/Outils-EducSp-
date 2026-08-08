import { Router } from "express";
import { z } from "zod";
import { generateBilan, BilanGenerationError } from "../services/bilanGenerator";
import { getPatientById } from "../repositories/patientRepository";
import {
  getDernierBilanValide,
  getDernierBilanDeTrame,
  creerBilanBrouillon,
  listBilansForPatient,
  getBilanById,
  getBilanAvecBeneficiaire,
  tableauDeBord,
  updateBilan,
} from "../repositories/bilanRepository";
import { getEtablissementById } from "../repositories/etablissementRepository";
import { getQuotaStatus, decrementerQuota } from "../services/quotaService";
import { schemaPourType, contenuVierge } from "../schema/modeleValidation";
import { genererBilanDocx, nomFichierBilanDocx } from "../services/bilanDocxExport";
import { journaliser } from "../services/auditService";
import { limiter } from "../middleware/limitation";
import {
  adresseIp,
  etablissementDe,
  exigerRole,
  libelle,
} from "../middleware/authentification";

export const bilansRouter = Router();

/**
 * La génération est l'appel le plus coûteux de l'application. Le quota mensuel
 * la borne déjà sur le mois ; ce plafond horaire borne une boucle emballée ou
 * un compte compromis avant que le quota entier n'y passe.
 */
const LIMITE_GENERATION = limiter({
  maximum: 20,
  fenetreMinutes: 60,
  intitule: "la génération de bilans",
});

bilansRouter.get("/api/patients/:id/bilans", async (req, res) => {
  const etablissementId = etablissementDe(req);
  const patient = await getPatientById(req.params.id, etablissementId);
  if (!patient) {
    return res.status(404).json({ error: "Bénéficiaire introuvable" });
  }
  res.json(await listBilansForPatient(req.params.id, etablissementId));
});

/** Vue d'ensemble : bilans validés par trame et brouillons en cours. */
bilansRouter.get(
  "/api/tableau-de-bord",
  exigerRole("coordinateur"),
  async (req, res) => {
    res.json(await tableauDeBord(etablissementDe(req)));
  }
);

bilansRouter.get("/api/bilans/:id", async (req, res) => {
  const etablissementId = etablissementDe(req);
  const bilan = await getBilanById(req.params.id, etablissementId);
  if (!bilan) {
    return res.status(404).json({ error: "Bilan introuvable" });
  }

  await journaliser({
    action: "bilan_consulte",
    utilisateurId: req.utilisateur!.id,
    utilisateurLibelle: libelle(req.utilisateur!),
    etablissementId,
    cibleType: "bilan",
    cibleId: bilan.id,
    details: { type_bilan: bilan.type_bilan, statut: bilan.statut },
    adresseIp: adresseIp(req),
  });

  res.json(bilan);
});

/**
 * Dernier bilan validé de la même trame, proposé comme point de départ.
 * Retourne `null` s'il n'y en a pas : c'est un cas courant, pas une erreur.
 */
bilansRouter.get("/api/patients/:id/bilans/precedent", async (req, res) => {
  const type = String(req.query.type ?? "");
  if (type !== "repit" && type !== "trimestriel") {
    return res.status(400).json({ error: "Type de trame inconnu" });
  }

  const etablissementId = etablissementDe(req);
  const patient = await getPatientById(req.params.id, etablissementId);
  if (!patient) {
    return res.status(404).json({ error: "Bénéficiaire introuvable" });
  }

  const precedent = await getDernierBilanDeTrame(req.params.id, etablissementId, type);
  return res.json(
    precedent ? { id: precedent.id, periode_fin: precedent.periode_fin } : null
  );
});

// Export .docx (§7) : un seul module de conversion (bilanDocxExport.ts),
// strictement fidèle au JSON validé, aucun recalcul.
bilansRouter.get("/api/bilans/:id/export.docx", async (req, res) => {
  const etablissementId = etablissementDe(req);
  const bilan = await getBilanAvecBeneficiaire(req.params.id, etablissementId);
  if (!bilan) {
    return res.status(404).json({ error: "Bilan introuvable" });
  }

  const etablissement = await getEtablissementById(etablissementId);
  const buffer = await genererBilanDocx(bilan.type_bilan, bilan.contenu, etablissement);
  const filename = nomFichierBilanDocx(
    bilan.type_bilan,
    bilan.beneficiaire,
    bilan.periode_debut,
    bilan.periode_fin
  );

  await journaliser({
    action: "bilan_exporte",
    utilisateurId: req.utilisateur!.id,
    utilisateurLibelle: libelle(req.utilisateur!),
    etablissementId,
    cibleType: "bilan",
    cibleId: req.params.id,
    cibleLibelle: bilan.beneficiaire,
    details: { type_bilan: bilan.type_bilan, fichier: filename },
    adresseIp: adresseIp(req),
  });

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
 *
 * L'auteur est celui de la session : il n'est plus déclaré par l'appelant.
 */
bilansRouter.post(
  "/api/patients/:id/bilans/generate",
  LIMITE_GENERATION,
  async (req, res) => {
    const patientId = req.params.id;
    const etablissementId = etablissementDe(req);
    const auteurId = req.utilisateur!.id;

    const parsed = GenerateBilanBodySchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        error: "Requête invalide",
        details: parsed.error.flatten(),
      });
    }

    const patient = await getPatientById(patientId, etablissementId);
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
      const quotaAvant = await getQuotaStatus(etablissementId);
      if (!quotaAvant) {
        return res.status(500).json({ error: "Établissement introuvable" });
      }
      if (quotaAvant.restant <= 0) {
        return res.status(429).json({
          error: "Quota mensuel de bilans atteint pour cet établissement",
          quota: quotaAvant,
        });
      }

      const previous = await getDernierBilanValide(patientId, etablissementId);
      const bilan = await generateBilan(inputText, previous?.contenu);

      const saved = await creerBilanBrouillon({
        patientId,
        etablissementId,
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
        etablissementId,
        quotaAvant.quota_mensuel
      );

      await journaliser({
        action: "bilan_genere",
        utilisateurId: auteurId,
        utilisateurLibelle: libelle(req.utilisateur!),
        etablissementId,
        cibleType: "bilan",
        cibleId: saved.id,
        cibleLibelle: `${patient.prenom} ${patient.nom}`,
        details: { type_bilan: "bilan", source },
        adresseIp: adresseIp(req),
      });

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
  }
);

const CreerBilanBodySchema = z.object({
  /** Le type « bilan » passe par la génération, pas par cette route. */
  type: z.enum(["repit", "trimestriel"]),
  periode_debut: z.string().min(1),
  periode_fin: z.string().min(1),
  /** Repartir du dernier bilan validé de la même trame. */
  reprendre_precedent: z.boolean().default(false),
});

/**
 * Ouvre un bilan à trame fixe (Répit, Trimestriel).
 *
 * Aucun appel au moteur ici : le document est rempli par l'éducateur dans un
 * parcours guidé. Le brouillon est créé d'emblée avec toutes ses clés, vides,
 * pour qu'un enregistrement partiel reste valide et qu'aucune section ne
 * disparaisse tant qu'elle n'a pas été remplie.
 *
 * `reprendre_precedent` recopie le dernier bilan validé de la même trame. Ce
 * n'est pas une donnée inventée — elle a été saisie par un professionnel — mais
 * elle date d'une autre période : l'interface la signale comme reprise tant
 * qu'elle n'a pas été revue, et le bilan garde le lien vers son prédécesseur.
 *
 * Le quota est décompté à la création, comme pour un bilan généré : c'est un
 * compteur de bilans, et la règle reste la même quelle que soit la trame.
 */
bilansRouter.post("/api/patients/:id/bilans", async (req, res) => {
  const patientId = req.params.id;
  const etablissementId = etablissementDe(req);
  const auteurId = req.utilisateur!.id;

  const parsed = CreerBilanBodySchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({
      error: "Requête invalide",
      details: parsed.error.flatten(),
    });
  }

  const patient = await getPatientById(patientId, etablissementId);
  if (!patient) {
    return res.status(404).json({ error: "Bénéficiaire introuvable" });
  }

  const { type, periode_debut, periode_fin, reprendre_precedent } = parsed.data;

  const quotaAvant = await getQuotaStatus(etablissementId);
  if (!quotaAvant) {
    return res.status(500).json({ error: "Établissement introuvable" });
  }
  if (quotaAvant.restant <= 0) {
    return res.status(429).json({
      error: "Quota mensuel de bilans atteint pour cet établissement",
      quota: quotaAvant,
    });
  }

  const precedent = reprendre_precedent
    ? await getDernierBilanDeTrame(patientId, etablissementId, type)
    : null;

  const contenu = (precedent
    ? structuredClone(precedent.contenu)
    : contenuVierge(type)) as Record<string, unknown>;

  const saved = await creerBilanBrouillon({
    patientId,
    etablissementId,
    auteurId,
    typeBilan: type,
    periodeDebut: periode_debut,
    periodeFin: periode_fin,
    // Le document n'est pas issu d'une dictée : il est saisi directement.
    // Les zones de commentaire peuvent l'être, mais pas le bilan dans son
    // ensemble.
    source: "texte",
    contenu,
    bilanPrecedentId: precedent?.id ?? null,
  });

  const quotaApres = await decrementerQuota(
    etablissementId,
    quotaAvant.quota_mensuel
  );

  await journaliser({
    action: "bilan_ouvert",
    utilisateurId: auteurId,
    utilisateurLibelle: libelle(req.utilisateur!),
    etablissementId,
    cibleType: "bilan",
    cibleId: saved.id,
    cibleLibelle: `${patient.prenom} ${patient.nom}`,
    details: { type_bilan: type, repris_de: precedent?.id ?? null },
    adresseIp: adresseIp(req),
  });

  return res.status(201).json({
    id: saved.id,
    statut: "brouillon",
    type_bilan: type,
    contenu,
    periode_debut,
    periode_fin,
    repris_de: precedent
      ? { id: precedent.id, periode_fin: precedent.periode_fin }
      : null,
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

  const etablissementId = etablissementDe(req);
  const existing = await getBilanById(req.params.id, etablissementId);
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

  const updated = await updateBilan(req.params.id, etablissementId, {
    contenu,
    statut: parsed.data.statut,
  });

  await journaliser({
    action: parsed.data.statut === "validé" ? "bilan_valide" : "bilan_modifie",
    utilisateurId: req.utilisateur!.id,
    utilisateurLibelle: libelle(req.utilisateur!),
    etablissementId,
    cibleType: "bilan",
    cibleId: req.params.id,
    details: { type_bilan: existing.type_bilan },
    adresseIp: adresseIp(req),
  });

  return res.json(updated);
});
