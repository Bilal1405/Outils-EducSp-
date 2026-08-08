import { Router } from "express";
import { z } from "zod";
import {
  creerUtilisateur,
  desactiverUtilisateur,
  getUtilisateurById,
  getUtilisateurParEmail,
  listUtilisateurs,
} from "../repositories/utilisateurRepository";
import { hacherMotDePasse, motDePasseAcceptable } from "../services/motDePasse";
import { fermerSessionsDe } from "../services/sessionService";
import { journaliser } from "../services/auditService";
import {
  adresseIp,
  etablissementDe,
  exigerRole,
  libelle,
} from "../middleware/authentification";

export const utilisateursRouter = Router();

/** Collègues de l'établissement. Sert à afficher qui a rédigé quel bilan. */
utilisateursRouter.get("/api/utilisateurs", async (req, res) => {
  res.json(await listUtilisateurs(etablissementDe(req)));
});

const CreerUtilisateurSchema = z.object({
  nom: z.string().min(1),
  prenom: z.string().min(1),
  email: z.string().email(),
  mot_de_passe: z.string(),
  role: z.enum(["educateur", "coordinateur", "admin"]).default("educateur"),
});

/**
 * Création d'un compte, réservée au coordinateur.
 *
 * Le nouveau compte est rattaché à l'établissement de la session : un
 * coordinateur ne peut pas créer d'utilisateur ailleurs, ni s'attribuer un
 * rôle supérieur au sien.
 */
utilisateursRouter.post(
  "/api/utilisateurs",
  exigerRole("coordinateur"),
  async (req, res) => {
    const parsed = CreerUtilisateurSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        error: "Requête invalide",
        details: parsed.error.flatten(),
      });
    }

    if (parsed.data.role === "admin" && req.utilisateur!.role !== "admin") {
      return res.status(403).json({
        error: "Seul un administrateur peut créer un autre administrateur.",
      });
    }

    const probleme = motDePasseAcceptable(parsed.data.mot_de_passe);
    if (probleme) {
      return res.status(400).json({ error: probleme });
    }

    if (await getUtilisateurParEmail(parsed.data.email)) {
      return res.status(409).json({
        error: "Un compte existe déjà avec cette adresse électronique.",
      });
    }

    const etablissementId = etablissementDe(req);
    const created = await creerUtilisateur({
      nom: parsed.data.nom,
      prenom: parsed.data.prenom,
      email: parsed.data.email,
      role: parsed.data.role,
      etablissementId,
      motDePasseHash: await hacherMotDePasse(parsed.data.mot_de_passe),
    });

    await journaliser({
      action: "utilisateur_cree",
      utilisateurId: req.utilisateur!.id,
      utilisateurLibelle: libelle(req.utilisateur!),
      etablissementId,
      cibleType: "utilisateur",
      cibleId: created.id,
      cibleLibelle: `${created.prenom} ${created.nom}`,
      details: { role: created.role },
      adresseIp: adresseIp(req),
    });

    return res.status(201).json(created);
  }
);

/**
 * Désactivation d'un compte. Jamais de suppression : l'utilisateur est
 * l'auteur de bilans archivés, l'effacer retirerait de l'archive l'identité
 * du rédacteur.
 */
utilisateursRouter.post(
  "/api/utilisateurs/:id/desactivation",
  exigerRole("coordinateur"),
  async (req, res) => {
    if (req.params.id === req.utilisateur!.id) {
      return res.status(400).json({
        error: "Vous ne pouvez pas désactiver votre propre compte.",
      });
    }

    const etablissementId = etablissementDe(req);
    const cible = await getUtilisateurById(req.params.id);
    if (!cible || cible.etablissement_id !== etablissementId) {
      return res.status(404).json({ error: "Utilisateur introuvable" });
    }

    await desactiverUtilisateur(req.params.id, etablissementId);
    // Les sessions ouvertes tombent immédiatement : une désactivation qui
    // laisserait travailler jusqu'à expiration n'en serait pas une.
    await fermerSessionsDe(req.params.id);

    await journaliser({
      action: "utilisateur_desactive",
      utilisateurId: req.utilisateur!.id,
      utilisateurLibelle: libelle(req.utilisateur!),
      etablissementId,
      cibleType: "utilisateur",
      cibleId: cible.id,
      cibleLibelle: `${cible.prenom} ${cible.nom}`,
      adresseIp: adresseIp(req),
    });

    return res.status(204).end();
  }
);
