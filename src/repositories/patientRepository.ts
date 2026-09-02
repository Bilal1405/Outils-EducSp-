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
 * Toutes les lectures et écritures portent l'établissement en paramètre
 * obligatoire, jamais optionnel.
 *
 * Il venait auparavant de la requête HTTP et ne servait qu'à filtrer un
 * affichage ; il vient désormais de la session et conditionne l'accès. Le
 * rendre obligatoire dans la signature fait qu'un appel non cloisonné ne
 * compile pas, plutôt que de dépendre de la vigilance de l'appelant.
 */
export async function listPatients(
  etablissementId: string
): Promise<PatientSummary[]> {
  const { rows } = await pool.query<PatientSummary>(
    `SELECT id, nom, prenom, date_naissance FROM patients
     WHERE etablissement_id = $1 ORDER BY nom, prenom`,
    [etablissementId]
  );
  return rows;
}

export async function getPatientById(
  id: string,
  etablissementId: string
): Promise<Patient | null> {
  const { rows } = await pool.query<Patient>(
    `SELECT id, nom, prenom, date_naissance, etablissement_id
     FROM patients WHERE id = $1 AND etablissement_id = $2`,
    [id, etablissementId]
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
  etablissementId: string,
  params: UpdatePatientParams
): Promise<Patient | null> {
  const { rows } = await pool.query<Patient>(
    `UPDATE patients SET nom = $1, prenom = $2, date_naissance = $3
     WHERE id = $4 AND etablissement_id = $5
     RETURNING id, nom, prenom, date_naissance, etablissement_id`,
    [params.nom, params.prenom, params.dateNaissance ?? null, id, etablissementId]
  );
  return rows[0] ?? null;
}

/**
 * Effacement définitif d'un bénéficiaire et de ses bilans.
 *
 * Les bilans partent par la cascade posée en migration 011. On les compte
 * avant de supprimer : le journal d'audit doit pouvoir attester de l'étendue
 * réelle de l'effacement, pas seulement du fait qu'il a eu lieu.
 */
export async function supprimerPatient(
  id: string,
  etablissementId: string
): Promise<number> {
  return pool.transaction(async (base) => {
    const { rows } = await base.query<{ total: string }>(
      `SELECT count(*)::text AS total FROM bilans WHERE patient_id = $1`,
      [id]
    );
    const bilans = Number(rows[0].total);

    await base.query(`DELETE FROM patients WHERE id = $1 AND etablissement_id = $2`, [
      id,
      etablissementId,
    ]);

    return bilans;
  });
}
