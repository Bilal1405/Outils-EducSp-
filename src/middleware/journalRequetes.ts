import type { NextFunction, Request, Response } from "express";

/**
 * Journal technique, distinct du journal d'audit.
 *
 * L'audit répond à « qui a consulté quel dossier » et vit en base ; celui-ci
 * répond à « qu'est-ce qui a été lent ou cassé » et part sur la sortie
 * standard, où l'hébergeur le collecte.
 *
 * Format JSON par ligne : lisible tel quel dans un terminal, et interrogeable
 * sans analyseur maison le jour où ces journaux sont envoyés ailleurs.
 *
 * Ce qui n'y figure jamais : le corps des requêtes, les paramètres de
 * recherche, l'identité des bénéficiaires. Un journal technique est copié,
 * transféré et conservé plus longtemps que la base ; y laisser fuiter une
 * donnée de santé annulerait le reste des précautions. Seul l'identifiant de
 * l'utilisateur est conservé, pour pouvoir relier un incident à une session.
 */

const SEUIL_LENT_MS = 2000;

export function journalRequetes(req: Request, res: Response, next: NextFunction): void {
  // Les fichiers statiques et la sonde de vivacité noieraient le journal.
  if (!req.path.startsWith("/api/")) {
    return next();
  }

  const debut = process.hrtime.bigint();

  res.on("finish", () => {
    const dureeMs = Number(process.hrtime.bigint() - debut) / 1e6;
    const entree = {
      horodatage: new Date().toISOString(),
      methode: req.method,
      // `route.path` est le motif (`/api/bilans/:id`), pas l'URL réelle :
      // il ne contient donc aucun identifiant.
      chemin: req.route?.path ?? req.path.replace(/[0-9a-f-]{36}/gi, ":id"),
      statut: res.statusCode,
      duree_ms: Math.round(dureeMs),
      utilisateur: req.utilisateur?.id ?? null,
      lent: dureeMs > SEUIL_LENT_MS || undefined,
    };

    const sortie = res.statusCode >= 500 ? console.error : console.log;
    sortie(JSON.stringify(entree));
  });

  next();
}
