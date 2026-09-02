import { pool } from "../db";

export type RoleUtilisateur = "educateur" | "coordinateur" | "admin";

export interface Utilisateur {
  id: string;
  nom: string;
  prenom: string;
  email: string;
  role: RoleUtilisateur;
  etablissement_id: string | null;
  actif: boolean;
}

interface UtilisateurAvecSecret extends Utilisateur {
  mot_de_passe_hash: string | null;
}

const COLONNES = `id, nom, prenom, email, role, etablissement_id, actif`;

/**
 * Utilisateurs d'un établissement. Le cloisonnement n'est pas optionnel :
 * l'établissement vient de la session, jamais de la requête.
 */
export async function listUtilisateurs(etablissementId: string): Promise<Utilisateur[]> {
  const { rows } = await pool.query<Utilisateur>(
    `SELECT ${COLONNES} FROM utilisateurs
     WHERE etablissement_id = $1 AND actif = TRUE
     ORDER BY nom, prenom`,
    [etablissementId]
  );
  return rows;
}

export async function getUtilisateurById(id: string): Promise<Utilisateur | null> {
  const { rows } = await pool.query<Utilisateur>(
    `SELECT ${COLONNES} FROM utilisateurs WHERE id = $1`,
    [id]
  );
  return rows[0] ?? null;
}

/** Recherche par adresse, insensible à la casse (cf. index de la migration 010). */
export async function getUtilisateurParEmail(
  email: string
): Promise<UtilisateurAvecSecret | null> {
  const { rows } = await pool.query<UtilisateurAvecSecret>(
    `SELECT ${COLONNES}, mot_de_passe_hash FROM utilisateurs WHERE lower(email) = lower($1)`,
    [email]
  );
  return rows[0] ?? null;
}

export interface CreerUtilisateurParams {
  nom: string;
  prenom: string;
  email: string;
  role: RoleUtilisateur;
  etablissementId: string;
  motDePasseHash: string;
}

export async function creerUtilisateur(
  params: CreerUtilisateurParams
): Promise<Utilisateur> {
  const { rows } = await pool.query<Utilisateur>(
    `INSERT INTO utilisateurs
       (nom, prenom, email, role, etablissement_id, mot_de_passe_hash)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING ${COLONNES}`,
    [
      params.nom,
      params.prenom,
      params.email,
      params.role,
      params.etablissementId,
      params.motDePasseHash,
    ]
  );
  return rows[0];
}

export async function changerMotDePasse(id: string, hash: string): Promise<void> {
  await pool.query(`UPDATE utilisateurs SET mot_de_passe_hash = $2 WHERE id = $1`, [
    id,
    hash,
  ]);
}

export async function marquerConnexion(id: string): Promise<void> {
  await pool.query(`UPDATE utilisateurs SET derniere_connexion = now() WHERE id = $1`, [
    id,
  ]);
}

/**
 * Désactivation plutôt que suppression : un utilisateur est référencé comme
 * auteur de bilans archivés, et le supprimer effacerait la trace de qui les a
 * rédigés. Un compte désactivé ne peut plus se connecter et ses sessions sont
 * révoquées par l'appelant.
 */
export async function desactiverUtilisateur(
  id: string,
  etablissementId: string
): Promise<boolean> {
  const { rowCount } = await pool.query(
    `UPDATE utilisateurs SET actif = FALSE
     WHERE id = $1 AND etablissement_id = $2`,
    [id, etablissementId]
  );
  return (rowCount ?? 0) > 0;
}

/**
 * Personne ne peut se connecter : l'application n'est pas encore utilisable.
 *
 * On compte les comptes **dotés d'un mot de passe**, et non les lignes de la
 * table. Les comptes créés avant l'authentification n'en ont pas : les compter
 * fermerait l'écran de mise en service alors qu'aucun d'eux ne permet
 * d'entrer, et l'instance resterait inaccessible pour toujours.
 *
 * La garantie de sécurité tient toujours : dès qu'un compte utilisable existe,
 * la mise en service est close.
 */
export async function aucunCompteUtilisable(): Promise<boolean> {
  const { rows } = await pool.query<{ total: string }>(
    `SELECT count(*)::text AS total FROM utilisateurs
     WHERE mot_de_passe_hash IS NOT NULL AND actif = TRUE`
  );
  return rows[0].total === "0";
}
