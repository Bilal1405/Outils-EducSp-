import { pool } from "../db";
import { getEtablissementById } from "../repositories/etablissementRepository";

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
 */
export async function getQuotaStatus(
  etablissementId: string
): Promise<QuotaStatus | null> {
  const etablissement = await getEtablissementById(etablissementId);
  if (!etablissement) {
    return null;
  }

  const mois = moisCourant();
  const { rows } = await pool.query<{ bilans_generes: number }>(
    `SELECT bilans_generes FROM quota_usage
     WHERE etablissement_id = $1 AND mois = $2`,
    [etablissementId, mois]
  );

  const consomme = rows[0]?.bilans_generes ?? 0;
  return {
    etablissement_id: etablissementId,
    mois,
    quota_mensuel: etablissement.quota_mensuel_bilans,
    consomme,
    restant: calculerQuotaRestant(etablissement.quota_mensuel_bilans, consomme),
  };
}

/**
 * Décrémente le quota mensuel (incrémente le compteur de consommation) —
 * dernier maillon de l'ordre imposé §2 : transcription → contexte N-1 →
 * génération → validation schéma → décrément quota. À appeler uniquement
 * après enregistrement réussi du bilan généré.
 */
export async function decrementerQuota(etablissementId: string): Promise<void> {
  const mois = moisCourant();
  await pool.query(
    `INSERT INTO quota_usage (etablissement_id, mois, bilans_generes)
     VALUES ($1, $2, 1)
     ON CONFLICT (etablissement_id, mois)
     DO UPDATE SET bilans_generes = quota_usage.bilans_generes + 1`,
    [etablissementId, mois]
  );
}
