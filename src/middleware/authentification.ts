import type { NextFunction, Request, Response } from "express";
import { baseInjoignable } from "../erreursBase";
import {
  NOM_COOKIE,
  prolongerSession,
  resoudreSession,
} from "../services/sessionService";
import type { RoleUtilisateur, Utilisateur } from "../repositories/utilisateurRepository";

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      /** Renseigné par `authentifier` ; absent tant que la session n'est pas résolue. */
      utilisateur?: Utilisateur;
      sessionId?: string;
    }
  }
}

/**
 * Lecture des cookies sans dépendance.
 *
 * Le jeton de session est opaque et vérifié en base : il n'a pas besoin d'être
 * signé, donc pas besoin de `cookie-parser`. Une dépendance de moins dans une
 * application qui manipule des données de santé, c'est une surface d'attaque
 * de moins.
 */
function lireCookies(entete: string | undefined): Record<string, string> {
  const cookies: Record<string, string> = {};
  if (!entete) return cookies;

  for (const morceau of entete.split(";")) {
    const separateur = morceau.indexOf("=");
    if (separateur < 1) continue;
    const nom = morceau.slice(0, separateur).trim();
    const valeur = morceau.slice(separateur + 1).trim();
    try {
      cookies[nom] = decodeURIComponent(valeur);
    } catch {
      cookies[nom] = valeur;
    }
  }
  return cookies;
}

export function adresseIp(req: Request): string {
  // Render place l'adresse réelle dans X-Forwarded-For ; on ne garde que le
  // premier maillon, les suivants sont ajoutés par les intermédiaires.
  const transmise = req.header("x-forwarded-for");
  if (transmise) {
    return transmise.split(",")[0].trim();
  }
  return req.socket.remoteAddress ?? "";
}

export function libelle(utilisateur: Utilisateur): string {
  return `${utilisateur.prenom} ${utilisateur.nom} <${utilisateur.email}>`;
}

/**
 * Résout la session si elle existe, sans rien exiger. Placé avant toutes les
 * routes pour que même les routes publiques sachent qui appelle.
 */
export async function authentifier(
  req: Request,
  _res: Response,
  next: NextFunction
): Promise<void> {
  const jeton = lireCookies(req.header("cookie"))[NOM_COOKIE];
  if (!jeton) {
    return next();
  }

  try {
    const session = await resoudreSession(jeton);
    if (session) {
      req.utilisateur = session.utilisateur;
      req.sessionId = session.sessionId;
      // Prolongation opportuniste : la fonction ne réécrit qu'au-delà d'une
      // heure d'inactivité, inutile d'attendre son issue pour répondre.
      void prolongerSession(session.sessionId);
    }
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("[auth] résolution de session impossible", err);
    // Une base injoignable ne doit pas se présenter comme une session expirée :
    // l'utilisateur se déconnecterait pour se reconnecter, en vain. On laisse
    // remonter, le gestionnaire d'erreur dira ce qu'il en est vraiment.
    if (baseInjoignable(err)) {
      return next(err);
    }
  }
  return next();
}

export function exigerAuthentification(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  if (!req.utilisateur) {
    res.status(401).json({ error: "Session expirée ou absente. Reconnectez-vous." });
    return;
  }
  if (!req.utilisateur.etablissement_id) {
    res.status(403).json({
      error:
        "Votre compte n'est rattaché à aucun établissement. Un administrateur doit le rattacher.",
    });
    return;
  }
  next();
}

const RANGS: Record<RoleUtilisateur, number> = {
  educateur: 1,
  coordinateur: 2,
  admin: 3,
};

/** Exige au moins ce rôle. Les rôles sont hiérarchiques, pas disjoints. */
export function exigerRole(minimum: RoleUtilisateur) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const utilisateur = req.utilisateur;
    if (!utilisateur) {
      res.status(401).json({ error: "Session expirée ou absente. Reconnectez-vous." });
      return;
    }
    if (RANGS[utilisateur.role] < RANGS[minimum]) {
      res.status(403).json({
        error: "Cette action demande un rôle de " + minimum + ".",
      });
      return;
    }
    next();
  };
}

/**
 * Établissement de la session. Toute lecture ou écriture de données passe par
 * ici : il n'existe aucun chemin où l'établissement viendrait de la requête.
 */
export function etablissementDe(req: Request): string {
  const id = req.utilisateur?.etablissement_id;
  if (!id) {
    // `exigerAuthentification` l'a déjà vérifié ; ce garde-fou attrape un
    // ordre de middlewares incorrect plutôt que de servir les données d'autrui.
    throw new Error("Établissement absent de la session");
  }
  return id;
}

const METHODES_SURES = new Set(["GET", "HEAD", "OPTIONS"]);

/**
 * Protection CSRF.
 *
 * L'authentification repose sur un cookie : sans garde, un site tiers pourrait
 * faire exécuter une requête au navigateur d'un éducateur connecté. Deux
 * verrous, indépendants l'un de l'autre :
 *
 *  - le cookie est `SameSite=Lax`, donc absent des requêtes POST venues d'une
 *    autre origine ;
 *  - un en-tête personnalisé est exigé sur toute méthode modifiante. Un
 *    formulaire HTML ou une image ne peuvent pas en poser ; seul du JavaScript
 *    le peut, et il serait alors soumis au contrôle d'origine du navigateur —
 *    que nous n'ouvrons pas (aucun CORS n'est activé).
 */
export const ENTETE_ANTI_CSRF = "x-outils-educsp";

export function protegerCsrf(req: Request, res: Response, next: NextFunction): void {
  if (METHODES_SURES.has(req.method)) {
    return next();
  }
  if (req.header(ENTETE_ANTI_CSRF) !== "1") {
    res.status(403).json({
      error: "Requête rejetée : en-tête d'origine manquant.",
    });
    return;
  }
  next();
}
