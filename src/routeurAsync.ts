import { Router } from "express";
import type { IRouter, NextFunction, Request, RequestHandler, Response } from "express";

/**
 * Routeur dont les gestionnaires asynchrones ne peuvent pas tuer le serveur.
 *
 * Express 4 n'attend pas la promesse rendue par un gestionnaire `async` : si
 * elle est rejetée — une base momentanément injoignable suffit — l'exception
 * ne passe jamais par le gestionnaire d'erreur central. Elle remonte en rejet
 * non capté, et Node 22 termine le processus. Observé en conditions réelles :
 *
 *     Error: connect ECONNREFUSED 127.0.0.1:5432
 *         at async aucunCompteUtilisable (utilisateurRepository.ts:126)
 *     [exited with code 1]
 *
 * Autrement dit, un hoquet de la base ne rendait pas une requête en erreur :
 * il faisait tomber l'application entière, et avec elle le travail en cours de
 * tous ceux qui étaient connectés.
 *
 * Le rejet est donc renvoyé vers `next()`, où le gestionnaire d'erreur de
 * `app.ts` le transforme en 500. Le remède est appliqué au routeur plutôt qu'à
 * chaque route : on ne peut pas l'oublier en ajoutant une route, et
 * `test/asynchrone.test.ts` vérifie qu'aucun fichier de routes n'utilise
 * `Router()` directement.
 */
const METHODES = ["get", "post", "put", "patch", "delete", "all"] as const;

function envelopper(gestionnaire: RequestHandler): RequestHandler {
  // Un gestionnaire d'erreur (quatre paramètres) n'est pas concerné : Express
  // l'appelle avec une signature différente, l'envelopper le rendrait muet.
  if (gestionnaire.length >= 4) {
    return gestionnaire;
  }

  return (req: Request, res: Response, next: NextFunction) => {
    try {
      const resultat = gestionnaire(req, res, next) as unknown;
      if (resultat instanceof Promise) {
        resultat.catch(next);
      }
      return resultat;
    } catch (err) {
      // Exception levée avant le premier `await` : elle est synchrone, Express
      // la rattraperait déjà, mais la traiter ici évite deux chemins.
      return next(err);
    }
  };
}

export function creerRouteur(): IRouter {
  const routeur = Router();

  for (const methode of METHODES) {
    const original = routeur[methode].bind(routeur) as (
      chemin: string,
      ...gestionnaires: RequestHandler[]
    ) => IRouter;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (routeur as any)[methode] = (chemin: string, ...gestionnaires: RequestHandler[]) =>
      original(chemin, ...gestionnaires.map(envelopper));
  }

  return routeur;
}
