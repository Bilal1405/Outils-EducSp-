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

export interface EtablissementRecense extends Etablissement {
  nombre_beneficiaires: number;
}

/**
 * Établissements déjà enregistrés, avec leur effectif. Sert à la mise en
 * service, qui doit distinguer deux situations que la seule présence d'une
 * ligne ne sépare pas :
 *
 *  - un établissement **peuplé** signe une instance mise à jour depuis une
 *    version sans authentification ; le premier compte doit s'y rattacher,
 *    sans quoi les bénéficiaires déjà saisis deviendraient invisibles ;
 *  - un établissement **vide** est presque toujours celui que sème la
 *    migration 004 (« Établissement par défaut ») pour rattacher d'anciennes
 *    données. Sur une base neuve il ne représente aucune structure réelle :
 *    la mise en service doit demander le vrai nom et renommer cette ligne.
 *
 * Le plus peuplé d'abord : c'est celui auquel se rattacher.
 */
export async function listerEtablissementsAvecEffectif(): Promise<
  EtablissementRecense[]
> {
  const { rows } = await pool.query<EtablissementRecense>(
    `SELECT e.id, e.nom, e.adresse, e.telephone, e.email, e.quota_mensuel_bilans,
            COUNT(p.id)::int AS nombre_beneficiaires
       FROM etablissements e
       LEFT JOIN patients p ON p.etablissement_id = e.id
      GROUP BY e.id
      ORDER BY COUNT(p.id) DESC, e.nom`
  );
  return rows;
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
