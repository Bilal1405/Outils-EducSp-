import { Router } from "express";
import { z } from "zod";
import { config } from "../config";
import {
  aucunCompteUtilisable,
  changerMotDePasse,
  creerUtilisateur,
  getUtilisateurParEmail,
  marquerConnexion,
} from "../repositories/utilisateurRepository";
import {
  creerEtablissement,
  listerEtablissements,
} from "../repositories/etablissementRepository";
import {
  hacherMotDePasse,
  motDePasseAcceptable,
  verifierMotDePasse,
} from "../services/motDePasse";
import {
  NOM_COOKIE,
  fermerSession,
  fermerSessionsDe,
  ouvrirSession,
} from "../services/sessionService";
import { journaliser } from "../services/auditService";
import {
  adresseIp,
  exigerAuthentification,
  libelle,
} from "../middleware/authentification";

export const authRouter = Router();

function poserCookie(res: import("express").Response, jeton: string, expireLe: Date) {
  res.cookie(NOM_COOKIE, jeton, {
    httpOnly: true, // inaccessible au JavaScript de la page : une faille XSS ne vole pas la session
    sameSite: "lax", // premier verrou anti-CSRF
    secure: config.env === "production", // en clair uniquement en développement local
    expires: expireLe,
    path: "/",
  });
}

// --- Initialisation ---------------------------------------------------------

const InitialisationSchema = z.object({
  /** Ignoré si un établissement existe déjà : le compte s'y rattache. */
  etablissement: z.string().min(1).optional(),
  quota_mensuel_bilans: z.number().int().positive().optional(),
  nom: z.string().min(1),
  prenom: z.string().min(1),
  email: z.string().email(),
  mot_de_passe: z.string(),
});

/**
 * Création du tout premier compte, avec son établissement.
 *
 * Ouverte sans authentification — il n'existe personne pour authentifier — mais
 * refusée dès qu'un compte existe. C'est la seule fenêtre : passé le premier
 * enregistrement, la route ne peut plus rien créer, quel que soit l'appelant.
 */
authRouter.post("/api/auth/initialisation", async (req, res) => {
  if (!(await aucunCompteUtilisable())) {
    return res.status(409).json({
      error: "L'application est déjà initialisée. Connectez-vous.",
    });
  }

  const parsed = InitialisationSchema.safeParse(req.body);
  if (!parsed.success) {
    return res
      .status(400)
      .json({ error: "Requête invalide", details: parsed.error.flatten() });
  }

  const probleme = motDePasseAcceptable(parsed.data.mot_de_passe);
  if (probleme) {
    return res.status(400).json({ error: probleme });
  }

  // Un établissement peut déjà exister — instance mise à jour depuis une
  // version sans authentification, où bénéficiaires et bilans lui sont
  // rattachés. En créer un second rendrait ces données invisibles au premier
  // compte. On s'y rattache donc, plutôt que d'en ouvrir un autre.
  const existants = await listerEtablissements();
  let etablissement: { id: string };
  if (existants.length > 0) {
    etablissement = { id: existants[0].id };
  } else {
    if (!parsed.data.etablissement) {
      return res.status(400).json({ error: "Nom de l'établissement requis." });
    }
    etablissement = await creerEtablissement(
      parsed.data.etablissement,
      parsed.data.quota_mensuel_bilans
    );
  }

  const utilisateur = await creerUtilisateur({
    nom: parsed.data.nom,
    prenom: parsed.data.prenom,
    email: parsed.data.email,
    role: "admin",
    etablissementId: etablissement.id,
    motDePasseHash: await hacherMotDePasse(parsed.data.mot_de_passe),
  });

  const { jeton, expireLe } = await ouvrirSession(utilisateur.id, {
    adresseIp: adresseIp(req),
    navigateur: req.header("user-agent") ?? undefined,
  });
  poserCookie(res, jeton, expireLe);

  await journaliser({
    action: "initialisation",
    utilisateurId: utilisateur.id,
    utilisateurLibelle: libelle(utilisateur),
    etablissementId: etablissement.id,
    cibleType: "etablissement",
    cibleId: etablissement.id,
    cibleLibelle: existants[0]?.nom ?? parsed.data.etablissement,
    details: { etablissement_repris: existants.length > 0 },
    adresseIp: adresseIp(req),
  });

  return res.status(201).json({ utilisateur, etablissement });
});

/**
 * L'interface a besoin de savoir s'il faut proposer la mise en service, et le
 * cas échéant si un établissement préexiste — auquel cas elle ne redemande pas
 * son nom.
 */
authRouter.get("/api/auth/etat", async (req, res) => {
  const initialise = !(await aucunCompteUtilisable());
  const existants = initialise ? [] : await listerEtablissements();

  res.json({
    initialise,
    utilisateur: req.utilisateur ?? null,
    etablissement_existant: existants[0]
      ? { id: existants[0].id, nom: existants[0].nom }
      : null,
  });
});

// --- Connexion --------------------------------------------------------------

const ConnexionSchema = z.object({
  email: z.string().min(1),
  mot_de_passe: z.string().min(1),
});

/**
 * Le message d'échec est le même que l'adresse soit inconnue, le mot de passe
 * faux ou le compte désactivé : distinguer permettrait d'énumérer les comptes
 * existants d'une structure.
 */
const ECHEC_CONNEXION = "Adresse électronique ou mot de passe incorrect.";

authRouter.post("/api/auth/connexion", async (req, res) => {
  const parsed = ConnexionSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: ECHEC_CONNEXION });
  }

  const utilisateur = await getUtilisateurParEmail(parsed.data.email);
  const motDePasseValide = await verifierMotDePasse(
    parsed.data.mot_de_passe,
    utilisateur?.mot_de_passe_hash ?? null
  );

  if (!utilisateur || !utilisateur.actif || !motDePasseValide) {
    await journaliser({
      action: "connexion_refusee",
      utilisateurId: utilisateur?.id ?? null,
      etablissementId: utilisateur?.etablissement_id ?? null,
      details: { email: parsed.data.email },
      adresseIp: adresseIp(req),
    });
    return res.status(401).json({ error: ECHEC_CONNEXION });
  }

  const { jeton, expireLe } = await ouvrirSession(utilisateur.id, {
    adresseIp: adresseIp(req),
    navigateur: req.header("user-agent") ?? undefined,
  });
  poserCookie(res, jeton, expireLe);
  await marquerConnexion(utilisateur.id);

  await journaliser({
    action: "connexion",
    utilisateurId: utilisateur.id,
    utilisateurLibelle: libelle(utilisateur),
    etablissementId: utilisateur.etablissement_id,
    adresseIp: adresseIp(req),
  });

  const { mot_de_passe_hash: _secret, ...sansSecret } = utilisateur;
  return res.json({ utilisateur: sansSecret });
});

authRouter.post("/api/auth/deconnexion", async (req, res) => {
  if (req.sessionId) {
    await fermerSession(req.sessionId);
    if (req.utilisateur) {
      await journaliser({
        action: "deconnexion",
        utilisateurId: req.utilisateur.id,
        utilisateurLibelle: libelle(req.utilisateur),
        etablissementId: req.utilisateur.etablissement_id,
        adresseIp: adresseIp(req),
      });
    }
  }
  res.clearCookie(NOM_COOKIE, { path: "/" });
  return res.status(204).end();
});

// --- Mot de passe -----------------------------------------------------------

const ChangementSchema = z.object({
  mot_de_passe_actuel: z.string().min(1),
  nouveau_mot_de_passe: z.string(),
});

authRouter.post(
  "/api/auth/mot-de-passe",
  exigerAuthentification,
  async (req, res) => {
    const parsed = ChangementSchema.safeParse(req.body);
    if (!parsed.success) {
      return res
        .status(400)
        .json({ error: "Requête invalide", details: parsed.error.flatten() });
    }

    const probleme = motDePasseAcceptable(parsed.data.nouveau_mot_de_passe);
    if (probleme) {
      return res.status(400).json({ error: probleme });
    }

    const utilisateur = req.utilisateur!;
    const complet = await getUtilisateurParEmail(utilisateur.email);
    const actuelValide = await verifierMotDePasse(
      parsed.data.mot_de_passe_actuel,
      complet?.mot_de_passe_hash ?? null
    );
    if (!actuelValide) {
      return res.status(403).json({ error: "Mot de passe actuel incorrect." });
    }

    await changerMotDePasse(
      utilisateur.id,
      await hacherMotDePasse(parsed.data.nouveau_mot_de_passe)
    );

    // Toutes les sessions tombent, y compris celles ouvertes ailleurs : c'est
    // l'intérêt principal d'un changement de mot de passe.
    await fermerSessionsDe(utilisateur.id);

    await journaliser({
      action: "mot_de_passe_change",
      utilisateurId: utilisateur.id,
      utilisateurLibelle: libelle(utilisateur),
      etablissementId: utilisateur.etablissement_id,
      adresseIp: adresseIp(req),
    });

    res.clearCookie(NOM_COOKIE, { path: "/" });
    return res.status(204).end();
  }
);
