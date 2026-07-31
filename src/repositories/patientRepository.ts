import { pool } from "../db";

export interface PatientSummary {
  id: string;
  nom: string;
  prenom: string;
}

export async function listPatients(): Promise<PatientSummary[]> {
  const { rows } = await pool.query<PatientSummary>(
    `SELECT id, nom, prenom FROM patients ORDER BY nom, prenom`
  );
  return rows;
}

export async function creerPatient(
  nom: string,
  prenom: string
): Promise<{ id: string }> {
  const { rows } = await pool.query<{ id: string }>(
    `INSERT INTO patients (nom, prenom) VALUES ($1, $2) RETURNING id`,
    [nom, prenom]
  );
  return rows[0];
}
