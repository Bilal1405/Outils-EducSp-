import { creerRouteur } from "../routeurAsync";
import { z } from "zod";
import {
  listPatients,
  getPatientById,
  creerPatient,
  updatePatient,
  supprimerPatient,
} from "../repositories/patientRepository";
import { journaliser } from "../services/auditService";
import {
  adresseIp,
  etablissementDe,
  exigerRole,
  libelle,
} from "../middleware/authentification";

export const patientsRouter = creerRouteur();

/**
 * Toutes les routes sont bornées à l'établissement de la session.
 *
 * Auparavant l'établissement arrivait en paramètre d'URL : l'appelant
 * choisissait donc les données qu'il voulait lire. Ce n'était pas un
 * cloisonnement, seulement un filtre d'affichage.
 */

patientsRouter.get("/api/patients", async (req, res) => {
  res.json(await listPatients(etablissementDe(req)));
});

patientsRouter.get("/api/patients/:id", async (req, res) => {
  const patient = await getPatientById(req.params.id, etablissementDe(req));
  if (!patient) {
    // Même réponse qu'un identifiant inexistant : distinguer « n'existe pas »
    // de « existe ailleurs » permettrait de sonder les autres établissements.
    return res.status(404).json({ error: "Bénéficiaire introuvable" });
  }

  await journaliser({
    action: "beneficiaire_consulte",
    utilisateurId: req.utilisateur!.id,
    utilisateurLibelle: libelle(req.utilisateur!),
    etablissementId: etablissementDe(req),
    cibleType: "beneficiaire",
    cibleId: patient.id,
    cibleLibelle: `${patient.prenom} ${patient.nom}`,
    adresseIp: adresseIp(req),
  });

  res.json(patient);
});

const CreerPatientSchema = z.object({
  nom: z.string().min(1),
  prenom: z.string().min(1),
  date_naissance: z.string().min(1).optional().nullable(),
});

patientsRouter.post("/api/patients", async (req, res) => {
  const parsed = CreerPatientSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({
      error: "Requête invalide",
      details: parsed.error.flatten(),
    });
  }

  const etablissementId = etablissementDe(req);
  const created = await creerPatient(
    parsed.data.nom,
    parsed.data.prenom,
    etablissementId,
    parsed.data.date_naissance
  );

  await journaliser({
    action: "beneficiaire_cree",
    utilisateurId: req.utilisateur!.id,
    utilisateurLibelle: libelle(req.utilisateur!),
    etablissementId,
    cibleType: "beneficiaire",
    cibleId: created.id,
    cibleLibelle: `${parsed.data.prenom} ${parsed.data.nom}`,
    adresseIp: adresseIp(req),
  });

  return res.status(201).json(created);
});

const UpdatePatientSchema = z.object({
  nom: z.string().min(1),
  prenom: z.string().min(1),
  date_naissance: z.string().min(1).optional().nullable(),
});

patientsRouter.patch("/api/patients/:id", async (req, res) => {
  const parsed = UpdatePatientSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({
      error: "Requête invalide",
      details: parsed.error.flatten(),
    });
  }

  const etablissementId = etablissementDe(req);
  const updated = await updatePatient(req.params.id, etablissementId, {
    nom: parsed.data.nom,
    prenom: parsed.data.prenom,
    dateNaissance: parsed.data.date_naissance,
  });
  if (!updated) {
    return res.status(404).json({ error: "Bénéficiaire introuvable" });
  }

  await journaliser({
    action: "beneficiaire_modifie",
    utilisateurId: req.utilisateur!.id,
    utilisateurLibelle: libelle(req.utilisateur!),
    etablissementId,
    cibleType: "beneficiaire",
    cibleId: updated.id,
    cibleLibelle: `${updated.prenom} ${updated.nom}`,
    adresseIp: adresseIp(req),
  });

  return res.json(updated);
});

/**
 * Droit à l'effacement (RGPD art. 17).
 *
 * La suppression emporte les bilans du bénéficiaire (cascade posée en
 * migration 011) : conserver des bilans orphelins reviendrait à ne pas
 * effacer. Réservé au coordinateur — c'est une action irréversible, et la
 * seule de l'application à l'être.
 *
 * L'entrée de journal survit à la suppression : elle ne contient plus de
 * donnée de santé, seulement la preuve que l'effacement a bien eu lieu, à
 * quelle date et par qui. C'est précisément ce qu'il faut pouvoir montrer.
 */
patientsRouter.delete(
  "/api/patients/:id",
  exigerRole("coordinateur"),
  async (req, res) => {
    const etablissementId = etablissementDe(req);
    const patient = await getPatientById(req.params.id, etablissementId);
    if (!patient) {
      return res.status(404).json({ error: "Bénéficiaire introuvable" });
    }

    const bilansSupprimes = await supprimerPatient(req.params.id, etablissementId);

    await journaliser({
      action: "beneficiaire_supprime",
      utilisateurId: req.utilisateur!.id,
      utilisateurLibelle: libelle(req.utilisateur!),
      etablissementId,
      cibleType: "beneficiaire",
      cibleId: patient.id,
      cibleLibelle: `${patient.prenom} ${patient.nom}`,
      details: { bilans_supprimes: bilansSupprimes },
      adresseIp: adresseIp(req),
    });

    return res.json({ supprime: true, bilans_supprimes: bilansSupprimes });
  }
);
