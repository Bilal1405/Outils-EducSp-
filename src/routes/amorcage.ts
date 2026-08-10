import { Router } from "express";
import { getEtablissementById } from "../repositories/etablissementRepository";
import { listPatients } from "../repositories/patientRepository";
import { listUtilisateurs } from "../repositories/utilisateurRepository";
import { getQuotaStatus } from "../services/quotaService";
import { etablissementDe } from "../middleware/authentification";

export const amorcageRouter = Router();

/**
 * Tout ce que l'interface demande au serveur pour s'afficher, en un appel.
 *
 * L'écran d'accueil réclamait auparavant cinq routes, appelées l'une après
 * l'autre parce que chacune dépendait de la précédente dans le code du
 * navigateur. Mesuré dans Chromium à 100 ms de latence — l'ordre de grandeur
 * d'un hébergeur distant — l'escalier coûtait 757 ms d'attente pure, pendant
 * lesquels l'éducateur regardait une page vide. Le travail réel, lui, tient en
 * quelques millisecondes de requêtes SQL.
 *
 * Les routes d'origine restent en place : elles servent au rafraîchissement
 * ciblé (le quota après une génération, l'équipe après un ajout de compte), et
 * cette route les appelle par les mêmes fonctions de dépôt plutôt que de
 * réécrire leurs requêtes — il n'y a donc pas deux définitions à maintenir.
 *
 * L'établissement vient de la session, comme partout ailleurs ; l'appelant ne
 * choisit rien.
 */
amorcageRouter.get("/api/amorcage", async (req, res) => {
  const etablissementId = etablissementDe(req);
  const utilisateur = req.utilisateur!;

  // En parallèle : ces quatre lectures ne dépendent pas les unes des autres.
  // Sérialisées, elles ajouteraient trois allers-retours à la base pour rien.
  const [etablissement, quota, beneficiaires, equipe] = await Promise.all([
    getEtablissementById(etablissementId),
    getQuotaStatus(etablissementId),
    listPatients(etablissementId),
    // La liste des comptes n'est visible que du coordinateur : ne pas la lire
    // du tout est plus sûr que la lire puis la retirer de la réponse.
    utilisateur.role === "educateur"
      ? Promise.resolve(null)
      : listUtilisateurs(etablissementId),
  ]);

  if (!etablissement) {
    return res.status(404).json({ error: "Établissement introuvable" });
  }

  return res.json({
    utilisateur,
    etablissement,
    quota,
    beneficiaires,
    equipe,
  });
});
