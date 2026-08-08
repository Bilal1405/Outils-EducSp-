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
  patientId: string,
  etablissementId: string
): Promise<BilanPrecedent | null> {
  const { rows } = await pool.query<{ id: string; contenu: unknown }>(
    `SELECT id, contenu FROM bilans
     WHERE patient_id = $1 AND etablissement_id = $2
       AND statut = 'validé' AND type_bilan = 'bilan'
     ORDER BY periode_fin DESC
     LIMIT 1`,
    [patientId, etablissementId]
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
  patientId: string,
  etablissementId: string
): Promise<BilanSummary[]> {
  const { rows } = await pool.query<BilanSummary>(
    `SELECT id, date_generation, type_bilan, periode_debut, periode_fin,
            statut, source
     FROM bilans
     WHERE patient_id = $1 AND etablissement_id = $2
     ORDER BY periode_fin DESC, date_generation DESC`,
    [patientId, etablissementId]
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

export async function getBilanById(
  id: string,
  etablissementId: string
): Promise<BilanDetail | null> {
  const { rows } = await pool.query<Omit<BilanDetail, "contenu"> & { contenu: unknown }>(
    `SELECT ${COLONNES_DETAIL} FROM bilans WHERE id = $1 AND etablissement_id = $2`,
    [id, etablissementId]
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
  id: string,
  etablissementId: string
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
     WHERE b.id = $1 AND b.etablissement_id = $2`,
    [id, etablissementId]
  );

  if (rows.length === 0) {
    return null;
  }

  const row = rows[0];
  return { ...row, contenu: parserContenu(row.type_bilan, row.contenu) };
}

/**
 * Dernier bilan **validé** d'une trame donnée, pour proposer d'en repartir.
 *
 * D'un trimestre à l'autre, une grille d'évaluation bouge peu : reprendre la
 * précédente évite de recoter soixante lignes identiques. On ne propose que du
 * validé — un brouillon peut être à moitié rempli, en repartir donnerait de
 * fausses cotations sans que rien ne le signale.
 */
export async function getDernierBilanDeTrame(
  patientId: string,
  etablissementId: string,
  type: TypeBilan
): Promise<{ id: string; periode_fin: string; contenu: ContenuBilan } | null> {
  const { rows } = await pool.query<{
    id: string;
    periode_fin: string;
    contenu: unknown;
  }>(
    `SELECT id, periode_fin, contenu FROM bilans
     WHERE patient_id = $1 AND etablissement_id = $2
       AND type_bilan = $3 AND statut = 'validé'
     ORDER BY periode_fin DESC, date_generation DESC
     LIMIT 1`,
    [patientId, etablissementId, type]
  );

  if (rows.length === 0) {
    return null;
  }
  return {
    id: rows[0].id,
    periode_fin: rows[0].periode_fin,
    contenu: parserContenu(type, rows[0].contenu),
  };
}

export interface LigneTableauDeBord {
  id: string;
  nom: string;
  prenom: string;
  dernier_bilan: string | null;
  dernier_repit: string | null;
  dernier_trimestriel: string | null;
  brouillons: number;
}

/**
 * Vue d'ensemble d'un établissement : pour chaque bénéficiaire, la fin de
 * période du dernier bilan validé de chaque trame, et le nombre de brouillons
 * en cours.
 *
 * Une seule requête agrégée plutôt qu'une par bénéficiaire : la page se charge
 * en un aller-retour quel que soit l'effectif.
 */
export async function tableauDeBord(
  etablissementId: string
): Promise<LigneTableauDeBord[]> {
  const { rows } = await pool.query<LigneTableauDeBord & { brouillons: string }>(
    `SELECT p.id, p.nom, p.prenom,
            max(b.periode_fin) FILTER (
              WHERE b.type_bilan = 'bilan' AND b.statut = 'validé') AS dernier_bilan,
            max(b.periode_fin) FILTER (
              WHERE b.type_bilan = 'repit' AND b.statut = 'validé') AS dernier_repit,
            max(b.periode_fin) FILTER (
              WHERE b.type_bilan = 'trimestriel' AND b.statut = 'validé') AS dernier_trimestriel,
            count(b.id) FILTER (WHERE b.statut = 'brouillon')::text AS brouillons
     FROM patients p
     LEFT JOIN bilans b ON b.patient_id = p.id
     WHERE p.etablissement_id = $1
     GROUP BY p.id, p.nom, p.prenom
     ORDER BY p.nom, p.prenom`,
    [etablissementId]
  );

  return rows.map((ligne) => ({ ...ligne, brouillons: Number(ligne.brouillons) }));
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
  etablissementId: string,
  params: UpdateBilanParams
): Promise<BilanDetail | null> {
  const { rows } = await pool.query<Omit<BilanDetail, "contenu"> & { contenu: unknown }>(
    `UPDATE bilans SET
       contenu = COALESCE($2, contenu),
       statut = COALESCE($3, statut)
     WHERE id = $1 AND etablissement_id = $4
     RETURNING ${COLONNES_DETAIL}`,
    [
      id,
      params.contenu !== undefined ? JSON.stringify(params.contenu) : null,
      params.statut ?? null,
      etablissementId,
    ]
  );

  if (rows.length === 0) {
    return null;
  }

  const row = rows[0];
  return { ...row, contenu: parserContenu(row.type_bilan, row.contenu) };
}
