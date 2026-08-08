import { pool } from "../db";

export interface Etablissement {
  id: string;
  nom: string;
  adresse: string;
  telephone: string;
  email: string;
  quota_mensuel_bilans: number;
}

const COLONNES = `id, nom, adresse, telephone, email, quota_mensuel_bilans`;

export async function getEtablissementById(
  id: string
): Promise<Etablissement | null> {
  const { rows } = await pool.query<Etablissement>(
    `SELECT ${COLONNES} FROM etablissements WHERE id = $1`,
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

export interface MajEtablissement {
  nom?: string;
  adresse?: string;
  telephone?: string;
  email?: string;
  quota_mensuel_bilans?: number;
}

/**
 * Mise à jour partielle. `COALESCE` laisse inchangée toute colonne dont la
 * valeur n'est pas fournie : un formulaire qui n'envoie que le téléphone ne
 * doit pas effacer l'adresse.
 */
export async function mettreAJourEtablissement(
  id: string,
  champs: MajEtablissement
): Promise<Etablissement | null> {
  const { rows } = await pool.query<Etablissement>(
    `UPDATE etablissements SET
       nom = COALESCE($2, nom),
       adresse = COALESCE($3, adresse),
       telephone = COALESCE($4, telephone),
       email = COALESCE($5, email),
       quota_mensuel_bilans = COALESCE($6, quota_mensuel_bilans)
     WHERE id = $1
     RETURNING ${COLONNES}`,
    [
      id,
      champs.nom ?? null,
      champs.adresse ?? null,
      champs.telephone ?? null,
      champs.email ?? null,
      champs.quota_mensuel_bilans ?? null,
    ]
  );
  return rows[0] ?? null;
}
