import { pool } from "../db";

export interface Brouillon {
  texte: string;
  periode_debut: string | null;
  periode_fin: string | null;
  source_dictee: boolean;
  maj_le: string;
}

export interface EcritureBrouillon {
  texte: string;
  periodeDebut: string | null;
  periodeFin: string | null;
  sourceDictee: boolean;
}

const COLONNES = `texte, periode_debut, periode_fin, source_dictee, maj_le`;

/**
 * Comme partout ailleurs, l'établissement est un paramètre obligatoire de la
 * signature : un appel non cloisonné ne compile pas.
 */
export async function getBrouillon(
  patientId: string,
  utilisateurId: string,
  etablissementId: string
): Promise<Brouillon | null> {
  const { rows } = await pool.query<Brouillon>(
    `SELECT ${COLONNES} FROM brouillons_saisie
     WHERE patient_id = $1 AND utilisateur_id = $2 AND etablissement_id = $3`,
    [patientId, utilisateurId, etablissementId]
  );
  return rows[0] ?? null;
}

/**
 * Écriture répétée pendant la frappe : un `UPSERT` plutôt qu'un couple
 * lecture-puis-écriture, pour qu'une saisie rapide ne produise jamais deux
 * lignes concurrentes.
 */
export async function enregistrerBrouillon(
  patientId: string,
  utilisateurId: string,
  etablissementId: string,
  champs: EcritureBrouillon
): Promise<Brouillon> {
  const { rows } = await pool.query<Brouillon>(
    `INSERT INTO brouillons_saisie
       (patient_id, utilisateur_id, etablissement_id,
        texte, periode_debut, periode_fin, source_dictee, maj_le)
     VALUES ($1, $2, $3, $4, $5, $6, $7, now())
     ON CONFLICT (patient_id, utilisateur_id)
     DO UPDATE SET texte = EXCLUDED.texte,
                   periode_debut = EXCLUDED.periode_debut,
                   periode_fin = EXCLUDED.periode_fin,
                   source_dictee = EXCLUDED.source_dictee,
                   maj_le = now()
     RETURNING ${COLONNES}`,
    [
      patientId,
      utilisateurId,
      etablissementId,
      champs.texte,
      champs.periodeDebut,
      champs.periodeFin,
      champs.sourceDictee,
    ]
  );
  return rows[0];
}

/**
 * Appelé quand le brouillon a rempli son office — bilan généré — ou quand
 * l'éducateur vide la zone de saisie. Un brouillon qui traîne est une donnée
 * de santé conservée sans raison.
 */
export async function supprimerBrouillon(
  patientId: string,
  utilisateurId: string,
  etablissementId: string
): Promise<void> {
  await pool.query(
    `DELETE FROM brouillons_saisie
     WHERE patient_id = $1 AND utilisateur_id = $2 AND etablissement_id = $3`,
    [patientId, utilisateurId, etablissementId]
  );
}
