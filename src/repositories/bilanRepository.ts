import { pool } from "../db";
import { BilanSchema, type Bilan } from "../schema/bilan.schema";

export type BilanSource = "texte" | "audio";

/**
 * Dernier bilan validé du patient (utilisé comme contexte de continuité
 * inter-bilans pour le prompt du bilan suivant). `null` si aucun bilan
 * validé n'existe encore.
 */
export async function getDernierBilanValide(
  patientId: string
): Promise<Bilan | null> {
  const { rows } = await pool.query<{ contenu: unknown }>(
    `SELECT contenu FROM bilans
     WHERE patient_id = $1 AND statut = 'validé'
     ORDER BY periode_fin DESC
     LIMIT 1`,
    [patientId]
  );

  if (rows.length === 0) {
    return null;
  }

  return BilanSchema.parse(rows[0].contenu);
}

export interface CreerBilanBrouillonParams {
  patientId: string;
  auteurId: string;
  periodeDebut: string;
  periodeFin: string;
  source: BilanSource;
  contenu: Bilan;
}

export async function creerBilanBrouillon(
  params: CreerBilanBrouillonParams
): Promise<{ id: string }> {
  const { rows } = await pool.query<{ id: string }>(
    `INSERT INTO bilans (patient_id, auteur_id, periode_debut, periode_fin, source, statut, contenu)
     VALUES ($1, $2, $3, $4, $5, 'brouillon', $6)
     RETURNING id`,
    [
      params.patientId,
      params.auteurId,
      params.periodeDebut,
      params.periodeFin,
      params.source,
      JSON.stringify(params.contenu),
    ]
  );

  return rows[0];
}
