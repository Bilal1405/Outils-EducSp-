import { Router } from "express";
import { z } from "zod";
import {
  listPatients,
  getPatientById,
  creerPatient,
  updatePatient,
} from "../repositories/patientRepository";

export const patientsRouter = Router();

patientsRouter.get("/api/patients", async (req, res) => {
  const etablissementId =
    typeof req.query.etablissement_id === "string"
      ? req.query.etablissement_id
      : undefined;
  const patients = await listPatients(etablissementId);
  res.json(patients);
});

patientsRouter.get("/api/patients/:id", async (req, res) => {
  const patient = await getPatientById(req.params.id);
  if (!patient) {
    return res.status(404).json({ error: "Bénéficiaire introuvable" });
  }
  res.json(patient);
});

const CreerPatientSchema = z.object({
  nom: z.string().min(1),
  prenom: z.string().min(1),
  etablissement_id: z.string().min(1),
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

  const created = await creerPatient(
    parsed.data.nom,
    parsed.data.prenom,
    parsed.data.etablissement_id,
    parsed.data.date_naissance
  );
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

  const updated = await updatePatient(req.params.id, {
    nom: parsed.data.nom,
    prenom: parsed.data.prenom,
    dateNaissance: parsed.data.date_naissance,
  });
  if (!updated) {
    return res.status(404).json({ error: "Bénéficiaire introuvable" });
  }
  return res.json(updated);
});
