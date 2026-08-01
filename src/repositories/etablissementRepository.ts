import { pool } from "../db";

export interface Etablissement {
  id: string;
  nom: string;
  quota_mensuel_bilans: number;
}

export async function listEtablissements(): Promise<Etablissement[]> {
  const { rows } = await pool.query<Etablissement>(
    `SELECT id, nom, quota_mensuel_bilans FROM etablissements ORDER BY nom`
  );
  return rows;
}

export async function getEtablissementById(
  id: string
): Promise<Etablissement | null> {
  const { rows } = await pool.query<Etablissement>(
    `SELECT id, nom, quota_mensuel_bilans FROM etablissements WHERE id = $1`,
    [id]
  );
  return rows[0] ?? null;
}

export async function creerEtablissement(
  nom: string,
  quotaMensuelBilans?: number
): Promise<{ id: string }> {
  const { rows } = await pool.query<{ id: string }>(
    quotaMensuelBilans === undefined
      ? `INSERT INTO etablissements (nom) VALUES ($1) RETURNING id`
      : `INSERT INTO etablissements (nom, quota_mensuel_bilans) VALUES ($1, $2) RETURNING id`,
    quotaMensuelBilans === undefined ? [nom] : [nom, quotaMensuelBilans]
  );
  return rows[0];
}
