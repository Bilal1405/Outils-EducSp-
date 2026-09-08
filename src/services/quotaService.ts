import { pool } from "../db";

export interface QuotaStatus {
  etablissement_id: string;
  mois: string; // "YYYY-MM-01"
  quota_mensuel: number;
  consomme: number;
  restant: number;
}

/** Premier jour du mois courant, au format DATE Postgres (YYYY-MM-DD). */
export function moisCourant(date: Date = new Date()): string {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  return `${year}-${month}-01`;
}

/** Calcul pur, testable sans DB : quota restant = quota - consommé, jamais négatif. */
export function calculerQuotaRestant(
  quotaMensuel: number,
  consomme: number
): number {
  return Math.max(0, quotaMensuel - consomme);
}

/**
 * État du quota mensuel d'un établissement pour le mois courant
 * (QUOTA-01). `null` si l'établissement n'existe pas.
 *
 * Le plafond (etablissements) et la consommation (quota_usage) sont lus en
 * une seule requête : le LEFT JOIN couvre le cas — normal en début de mois —
 * où aucune ligne de consommation n'existe encore.
 */
export async function getQuotaStatus(
  etablissementId: string
): Promise<QuotaStatus | null> {
  const mois = moisCourant();
  const { rows } = await pool.query<{
    quota_mensuel_bilans: number;
    bilans_generes: number | null;
  }>(
    `SELECT e.quota_mensuel_bilans, q.bilans_generes
     FROM etablissements e
     LEFT JOIN quota_usage q
       ON q.etablissement_id = e.id AND q.mois = $2
     WHERE e.id = $1`,
    [etablissementId, mois]
  );

  if (rows.length === 0) {
    return null;
  }

  const { quota_mensuel_bilans, bilans_generes } = rows[0];
  const consomme = bilans_generes ?? 0;
  return {
    etablissement_id: etablissementId,
    mois,
    quota_mensuel: quota_mensuel_bilans,
    consomme,
    restant: calculerQuotaRestant(quota_mensuel_bilans, consomme),
  };
}

/**
 * Décrémente le quota mensuel (incrémente le compteur de consommation) —
 * dernier maillon de l'ordre imposé §2 : contexte N-1 → génération →
 * validation schéma → décrément quota. À appeler uniquement après
 * enregistrement réussi du bilan généré.
 *
 * Renvoie l'état du quota après décrément, obtenu via RETURNING : l'appelant
 * n'a pas à relire la table. `quotaMensuel` est le plafond déjà connu de
 * l'appelant (il vient d'être lu pour autoriser la génération).
 */
export async function decrementerQuota(
  etablissementId: string,
  quotaMensuel: number
): Promise<QuotaStatus> {
  const mois = moisCourant();
  const { rows } = await pool.query<{ bilans_generes: number }>(
    `INSERT INTO quota_usage (etablissement_id, mois, bilans_generes)
     VALUES ($1, $2, 1)
     ON CONFLICT (etablissement_id, mois)
     DO UPDATE SET bilans_generes = quota_usage.bilans_generes + 1
     RETURNING bilans_generes`,
    [etablissementId, mois]
  );

  const consomme = rows[0].bilans_generes;
  return {
    etablissement_id: etablissementId,
    mois,
    quota_mensuel: quotaMensuel,
    consomme,
    restant: calculerQuotaRestant(quotaMensuel, consomme),
  };
}
