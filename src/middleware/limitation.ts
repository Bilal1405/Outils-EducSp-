import type { NextFunction, Request, Response } from "express";

/**
 * Limitation de débit sur les routes qui appellent le moteur.
 *
 * Le quota mensuel compte des bilans ; il ne protège pas contre un usage
 * anormal de la reformulation, qui n'en consomme pas. Sans plafond, un compte
 * — compromis, ou une boucle d'interface mal fermée — peut épuiser le crédit
 * du fournisseur en quelques minutes.
 *
 * Le compteur vit en mémoire du processus. C'est suffisant tant qu'une seule
 * instance sert le trafic ; avec plusieurs instances, chacune appliquerait sa
 * propre limite et le plafond effectif serait multiplié d'autant. Le jour où
 * l'application est répliquée, il faudra déplacer ce compteur en base ou dans
 * un cache partagé.
 */

interface Fenetre {
  debut: number;
  compte: number;
}

const compteurs = new Map<string, Fenetre>();

/** Évite que la table enfle indéfiniment sur un long processus. */
function purger(maintenant: number, dureeMs: number): void {
  for (const [cle, fenetre] of compteurs) {
    if (maintenant - fenetre.debut > dureeMs * 2) {
      compteurs.delete(cle);
    }
  }
}

export interface OptionsLimitation {
  /** Nombre d'appels autorisés par fenêtre. */
  maximum: number;
  /** Durée de la fenêtre, en minutes. */
  fenetreMinutes: number;
  /** Nom court, repris dans le message d'erreur. */
  intitule: string;
}

export function limiter({ maximum, fenetreMinutes, intitule }: OptionsLimitation) {
  const dureeMs = fenetreMinutes * 60_000;

  return (req: Request, res: Response, next: NextFunction): void => {
    // La clé est l'utilisateur authentifié, pas l'adresse IP : dans un ESMS,
    // tout le monde partage la même sortie Internet, et compter par IP
    // pénaliserait une équipe entière pour l'usage d'une seule personne.
    const cle = `${intitule}:${req.utilisateur?.id ?? "anonyme"}`;
    const maintenant = Date.now();

    if (compteurs.size > 5000) {
      purger(maintenant, dureeMs);
    }

    const fenetre = compteurs.get(cle);
    if (!fenetre || maintenant - fenetre.debut > dureeMs) {
      compteurs.set(cle, { debut: maintenant, compte: 1 });
      return next();
    }

    if (fenetre.compte >= maximum) {
      const resteSecondes = Math.ceil((fenetre.debut + dureeMs - maintenant) / 1000);
      res.setHeader("Retry-After", String(resteSecondes));
      res.status(429).json({
        error:
          `Trop d'appels à ${intitule} : ${maximum} par ${fenetreMinutes} minutes. ` +
          `Réessayez dans ${Math.ceil(resteSecondes / 60)} minute(s).`,
      });
      return;
    }

    fenetre.compte += 1;
    next();
  };
}

/** Réinitialise les compteurs — réservé aux tests. */
export function reinitialiserLimitation(): void {
  compteurs.clear();
}
