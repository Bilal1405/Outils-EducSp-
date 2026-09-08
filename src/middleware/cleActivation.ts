import { timingSafeEqual } from "node:crypto";
import type { NextFunction, Request, Response } from "express";

/**
 * La porte par laquelle l'application installée sur un téléphone atteint le
 * moteur de rédaction.
 *
 * La version pour praticien indépendant n'a pas de serveur : ses dossiers
 * vivent sur l'appareil, et c'est tout l'intérêt. Mais un modèle de langage ne
 * tient pas dans un téléphone, et la clé du fournisseur ne peut pas y être
 * déposée — elle serait lisible par quiconque ouvre l'application. Le seul
 * appel qui sort de l'appareil passe donc ici, et rien d'autre.
 *
 * Ce n'est pas une session : il n'y a ni compte, ni établissement, ni dossier
 * côté serveur. C'est une clé d'activation, partagée par l'appareil, qui ouvre
 * exactement deux routes sans écriture — rédiger, reformuler — et sert
 * d'identité au limiteur de débit, pour qu'un appareil ne consomme pas le
 * plafond des autres.
 *
 * Deux principes :
 *
 *  - **fermé par défaut.** Sans `CLES_ACTIVATION_LOCALE`, la fonction n'existe
 *    pas : 503, et l'application le dit. Un oubli de configuration ferme, il
 *    n'ouvre jamais ;
 *  - **comparaison à temps constant.** Comparer deux chaînes avec `===` rend
 *    une réponse d'autant plus tardive que le préfixe est juste ; sur un
 *    secret court, cela se mesure.
 */
export const ENTETE_CLE_ACTIVATION = "x-cle-activation";

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      /** Renseigné par `exigerCleActivation` ; sert d'identité au limiteur. */
      cleActivation?: string;
    }
  }
}

/**
 * Lue à chaque appel plutôt qu'au chargement du module : les tests posent la
 * variable après l'import, et un redéploiement ne doit pas être le seul moyen
 * de révoquer une clé.
 */
function clesConfigurees(): string[] {
  return (process.env.CLES_ACTIVATION_LOCALE ?? "")
    .split(",")
    .map((cle) => cle.trim())
    .filter(Boolean);
}

/** Comparaison sans fuite de temps. Les longueurs différentes sortent tôt : la
 *  longueur d'un secret n'est pas ce qu'on protège. */
function memeCle(fournie: string, attendue: string): boolean {
  const a = Buffer.from(fournie, "utf8");
  const b = Buffer.from(attendue, "utf8");
  return a.length === b.length && timingSafeEqual(a, b);
}

export function exigerCleActivation(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  const cles = clesConfigurees();

  if (cles.length === 0) {
    res.status(503).json({
      error:
        "La rédaction assistée n'est pas ouverte sur ce serveur. " +
        "Elle demande une clé d'activation, qui n'y est pas configurée.",
    });
    return;
  }

  const fournie = req.header(ENTETE_CLE_ACTIVATION) ?? "";
  if (!fournie || !cles.some((attendue) => memeCle(fournie, attendue))) {
    res.status(401).json({
      error:
        "Clé d'activation absente ou refusée. Renseignez-la dans les réglages " +
        "de l'application, section « Rédaction assistée ».",
    });
    return;
  }

  // Reprise par le limiteur de débit : sans elle, tous les appareils
  // partageraient un même compteur et le premier viderait le plafond de tous.
  req.cleActivation = fournie;
  next();
}
