import { pool } from "../db";

export interface PatientSummary {
  id: string;
  nom: string;
  prenom: string;
  /** Affiché sous forme d'âge dans la liste de l'interface. */
  date_naissance: string | null;
}

export interface Patient extends PatientSummary {
  etablissement_id: string;
}

/**
 * Liste des patients, optionnellement filtrée par établissement
 * (cloisonnement, BRIEF_PROJET §8). Le filtrage n'est pas encore imposé
 * par une couche d'authentification réelle (Keycloak À ARBITRER) : le
 * paramètre reste optionnel pour cette itération, prêt à devenir
 * obligatoire une fois l'identité de l'établissement dérivée de la session.
 */
export async function listPatients(
  etablissementId?: string
): Promise<PatientSummary[]> {
  if (etablissementId) {
    const { rows } = await pool.query<PatientSummary>(
      `SELECT id, nom, prenom, date_naissance FROM patients
       WHERE etablissement_id = $1 ORDER BY nom, prenom`,
      [etablissementId]
    );
    return rows;
  }
  const { rows } = await pool.query<PatientSummary>(
    `SELECT id, nom, prenom, date_naissance FROM patients ORDER BY nom, prenom`
  );
  return rows;
}

export async function getPatientById(id: string): Promise<Patient | null> {
  const { rows } = await pool.query<Patient>(
    `SELECT id, nom, prenom, date_naissance, etablissement_id FROM patients WHERE id = $1`,
    [id]
  );
  return rows[0] ?? null;
}

export async function creerPatient(
  nom: string,
  prenom: string,
  etablissementId: string,
  dateNaissance?: string | null
): Promise<{ id: string }> {
  const { rows } = await pool.query<{ id: string }>(
    `INSERT INTO patients (nom, prenom, date_naissance, etablissement_id)
     VALUES ($1, $2, $3, $4) RETURNING id`,
    [nom, prenom, dateNaissance ?? null, etablissementId]
  );
  return rows[0];
}

export interface UpdatePatientParams {
  nom: string;
  prenom: string;
  dateNaissance?: string | null;
}

export async function updatePatient(
  id: string,
  params: UpdatePatientParams
): Promise<Patient | null> {
  const { rows } = await pool.query<Patient>(
    `UPDATE patients SET nom = $1, prenom = $2, date_naissance = $3
     WHERE id = $4
     RETURNING id, nom, prenom, date_naissance, etablissement_id`,
    [params.nom, params.prenom, params.dateNaissance ?? null, id]
  );
  return rows[0] ?? null;
}
