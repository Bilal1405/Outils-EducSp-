import { Router } from "express";
import { z } from "zod";
import { listPatients, creerPatient } from "../repositories/patientRepository";

export const patientsRouter = Router();

patientsRouter.get("/api/patients", async (_req, res) => {
  const patients = await listPatients();
  res.json(patients);
});

const CreerPatientSchema = z.object({
  nom: z.string().min(1),
  prenom: z.string().min(1),
});

patientsRouter.post("/api/patients", async (req, res) => {
  const parsed = CreerPatientSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({
      error: "Requête invalide",
      details: parsed.error.flatten(),
    });
  }

  const created = await creerPatient(parsed.data.nom, parsed.data.prenom);
  return res.status(201).json(created);
});
