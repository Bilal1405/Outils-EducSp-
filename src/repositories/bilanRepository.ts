import { pool } from "../db";
import { BilanSchema, type Bilan } from "../schema/bilan.schema";
import { schemaPourType } from "../schema/modeleValidation";
import type { TypeBilan } from "../schema/modelesBilan";

export type BilanSource = "texte" | "audio";
export type BilanStatut = "brouillon" | "validé";

/**
 * Contenu d'un bilan, quelle que soit sa trame. La forme exacte dépend de
 * `type_bilan` : `Bilan` pour le type « bilan », l'arborescence décrite par
 * `modelesBilan.ts` pour les deux autres. Les consommateurs qui doivent
 * distinguer (l'export .docx) le font sur `type_bilan`, jamais en devinant.
 */
export type ContenuBilan = Bilan | Record<string, unknown>;

function parserContenu(type: TypeBilan, brut: unknown): ContenuBilan {
  return schemaPourType(type).parse(brut) as ContenuBilan;
}

export interface BilanPrecedent {
  id: string;
  contenu: Bilan;
}

/**
 * Dernier bilan validé du patient (utilisé comme contexte de continuité
 * inter-bilans pour le prompt du bilan suivant, BIL-03). Retourne aussi
 * son id pour traçabilité (G3 : bilan précédent référencé) — `null` si
 * aucun bilan validé n'existe encore (1ère évaluation, cf §2 cas limites).
 *
 * Restreint au type « bilan » : le moteur ne sait relire que cette trame, et
 * un bilan de répit validé entre-temps produirait une erreur de validation au
 * lieu d'un contexte.
 */
export async function getDernierBilanValide(
  patientId: string
): Promise<BilanPrecedent | null> {
  const { rows } = await pool.query<{ id: string; contenu: unknown }>(
    `SELECT id, contenu FROM bilans
     WHERE patient_id = $1 AND statut = 'validé' AND type_bilan = 'bilan'
     ORDER BY periode_fin DESC
     LIMIT 1`,
    [patientId]
  );

  if (rows.length === 0) {
    return null;
  }

  return { id: rows[0].id, contenu: BilanSchema.parse(rows[0].contenu) };
}

export interface CreerBilanBrouillonParams {
  patientId: string;
  etablissementId: string;
  auteurId: string;
  typeBilan: TypeBilan;
  periodeDebut: string;
  periodeFin: string;
  source: BilanSource;
  contenu: ContenuBilan;
  bilanPrecedentId?: string | null;
}

export async function creerBilanBrouillon(
  params: CreerBilanBrouillonParams
): Promise<{ id: string }> {
  const { rows } = await pool.query<{ id: string }>(
    `INSERT INTO bilans
       (patient_id, etablissement_id, auteur_id, type_bilan, periode_debut,
        periode_fin, source, statut, contenu, bilan_precedent_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, 'brouillon', $8, $9)
     RETURNING id`,
    [
      params.patientId,
      params.etablissementId,
      params.auteurId,
      params.typeBilan,
      params.periodeDebut,
      params.periodeFin,
      params.source,
      JSON.stringify(params.contenu),
      params.bilanPrecedentId ?? null,
    ]
  );

  return rows[0];
}

export interface BilanSummary {
  id: string;
  date_generation: string;
  type_bilan: TypeBilan;
  periode_debut: string;
  periode_fin: string;
  statut: BilanStatut;
  source: BilanSource;
}

/**
 * Historique des bilans d'un patient, du plus récent au plus ancien
 * (par période couverte, puis par date de génération).
 */
export async function listBilansForPatient(
  patientId: string
): Promise<BilanSummary[]> {
  const { rows } = await pool.query<BilanSummary>(
    `SELECT id, date_generation, type_bilan, periode_debut, periode_fin,
            statut, source
     FROM bilans
     WHERE patient_id = $1
     ORDER BY periode_fin DESC, date_generation DESC`,
    [patientId]
  );
  return rows;
}

export interface BilanDetail extends BilanSummary {
  patient_id: string;
  etablissement_id: string;
  auteur_id: string;
  bilan_precedent_id: string | null;
  contenu: ContenuBilan;
}

const COLONNES_DETAIL = `id, patient_id, etablissement_id, auteur_id, date_generation,
            type_bilan, periode_debut, periode_fin, statut, source,
            bilan_precedent_id, contenu`;

export async function getBilanById(id: string): Promise<BilanDetail | null> {
  const { rows } = await pool.query<Omit<BilanDetail, "contenu"> & { contenu: unknown }>(
    `SELECT ${COLONNES_DETAIL} FROM bilans WHERE id = $1`,
    [id]
  );

  if (rows.length === 0) {
    return null;
  }

  const row = rows[0];
  return { ...row, contenu: parserContenu(row.type_bilan, row.contenu) };
}

export interface BilanAvecBeneficiaire {
  type_bilan: TypeBilan;
  contenu: ContenuBilan;
  periode_debut: string;
  periode_fin: string;
  beneficiaire: string;
}

/**
 * Bilan et identité du bénéficiaire en une seule requête, pour l'export .docx
 * dont le nom de fichier combine les deux. Évite l'aller-retour supplémentaire
 * qu'imposerait la lecture séparée du patient (son id n'est connu qu'après
 * lecture du bilan, les deux requêtes ne seraient donc pas parallélisables).
 */
export async function getBilanAvecBeneficiaire(
  id: string
): Promise<BilanAvecBeneficiaire | null> {
  const { rows } = await pool.query<{
    type_bilan: TypeBilan;
    contenu: unknown;
    periode_debut: string;
    periode_fin: string;
    beneficiaire: string;
  }>(
    `SELECT b.type_bilan, b.contenu, b.periode_debut, b.periode_fin,
            p.prenom || ' ' || p.nom AS beneficiaire
     FROM bilans b
     JOIN patients p ON p.id = b.patient_id
     WHERE b.id = $1`,
    [id]
  );

  if (rows.length === 0) {
    return null;
  }

  const row = rows[0];
  return { ...row, contenu: parserContenu(row.type_bilan, row.contenu) };
}

export interface UpdateBilanParams {
  contenu?: ContenuBilan;
  /** Seule transition autorisée par cette voie : brouillon → validé. */
  statut?: "validé";
}

/**
 * Met à jour un bilan brouillon (édition de contenu et/ou passage en
 * statut validé). L'appelant doit avoir vérifié au préalable que le bilan
 * n'est pas déjà validé (archivage définitif, immutable — cf routes/bilans.ts).
 */
export async function updateBilan(
  id: string,
  params: UpdateBilanParams
): Promise<BilanDetail | null> {
  const { rows } = await pool.query<Omit<BilanDetail, "contenu"> & { contenu: unknown }>(
    `UPDATE bilans SET
       contenu = COALESCE($2, contenu),
       statut = COALESCE($3, statut)
     WHERE id = $1
     RETURNING ${COLONNES_DETAIL}`,
    [
      id,
      params.contenu !== undefined ? JSON.stringify(params.contenu) : null,
      params.statut ?? null,
    ]
  );

  if (rows.length === 0) {
    return null;
  }

  const row = rows[0];
  return { ...row, contenu: parserContenu(row.type_bilan, row.contenu) };
}
