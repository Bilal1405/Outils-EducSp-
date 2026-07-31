import { Router } from "express";
import { z } from "zod";
import {
  listUtilisateurs,
  creerUtilisateur,
} from "../repositories/utilisateurRepository";

export const utilisateursRouter = Router();

utilisateursRouter.get("/api/utilisateurs", async (_req, res) => {
  const utilisateurs = await listUtilisateurs();
  res.json(utilisateurs);
});

const CreerUtilisateurSchema = z.object({
  nom: z.string().min(1),
  prenom: z.string().min(1),
  email: z.string().email(),
});

utilisateursRouter.post("/api/utilisateurs", async (req, res) => {
  const parsed = CreerUtilisateurSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({
      error: "Requête invalide",
      details: parsed.error.flatten(),
    });
  }

  const created = await creerUtilisateur(
    parsed.data.nom,
    parsed.data.prenom,
    parsed.data.email
  );
  return res.status(201).json(created);
});
