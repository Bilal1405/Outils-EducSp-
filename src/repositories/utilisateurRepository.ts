import { pool } from "../db";

export interface UtilisateurSummary {
  id: string;
  nom: string;
  prenom: string;
  email: string;
}

export async function listUtilisateurs(): Promise<UtilisateurSummary[]> {
  const { rows } = await pool.query<UtilisateurSummary>(
    `SELECT id, nom, prenom, email FROM utilisateurs ORDER BY nom, prenom`
  );
  return rows;
}

export async function creerUtilisateur(
  nom: string,
  prenom: string,
  email: string
): Promise<{ id: string }> {
  const { rows } = await pool.query<{ id: string }>(
    `INSERT INTO utilisateurs (nom, prenom, email) VALUES ($1, $2, $3) RETURNING id`,
    [nom, prenom, email]
  );
  return rows[0];
}
