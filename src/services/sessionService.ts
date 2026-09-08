import { createHash, randomBytes } from "node:crypto";
import { pool } from "../db";
import type { Utilisateur } from "../repositories/utilisateurRepository";

/**
 * Sessions serveur.
 *
 * Le navigateur reçoit un jeton aléatoire de 256 bits ; la base n'en conserve
 * que l'empreinte SHA-256. Une lecture de la table `sessions` ne permet donc
 * pas de se faire passer pour quelqu'un.
 *
 * Ce sont des sessions opaques et non des jetons autoportés (JWT) : dans un
 * outil qui manipule des données de santé, révoquer un accès doit prendre
 * effet immédiatement. Un JWT reste valide jusqu'à son expiration, quoi qu'on
 * fasse côté serveur.
 *
 * Le hachage est un simple SHA-256, sans sel ni fonction lente : le jeton est
 * déjà 256 bits d'aléa, il n'y a rien à deviner par force brute — la lenteur
 * n'aurait ici aucun apport et coûterait à chaque requête.
 */

export const NOM_COOKIE = "session_educsp";

/**
 * Témoin lisible par la page, posé et retiré en même temps que le cookie de
 * session — qui, lui, reste inaccessible au JavaScript.
 *
 * Il ne contient aucun jeton et n'ouvre aucun droit : le serveur ne le regarde
 * jamais. Il répond à une seule question, côté navigateur : « ai-je une chance
 * d'être connecté ? ». Sans lui, l'interface devait demander « qui suis-je ? »
 * avant de demander ses données, soit un aller-retour complet ajouté à chaque
 * ouverture ; en le posant, elle demande directement ses données, et n'essuie
 * un refus que si la session a été fermée entre-temps.
 */
export const NOM_COOKIE_TEMOIN = "session_presente";

/** Durée de vie d'une session : une journée de travail, renouvelée à l'usage. */
const DUREE_HEURES = 12;

export interface SessionActive {
  sessionId: string;
  utilisateur: Utilisateur;
}

function empreinte(jeton: string): string {
  return createHash("sha256").update(jeton).digest("hex");
}

export interface ContexteConnexion {
  adresseIp?: string;
  navigateur?: string;
}

export async function ouvrirSession(
  utilisateurId: string,
  contexte: ContexteConnexion = {}
): Promise<{ jeton: string; expireLe: Date }> {
  const jeton = randomBytes(32).toString("base64url");
  const expireLe = new Date(Date.now() + DUREE_HEURES * 3600 * 1000);

  await pool.query(
    `INSERT INTO sessions (jeton_hash, utilisateur_id, expire_le, adresse_ip, navigateur)
     VALUES ($1, $2, $3, $4, $5)`,
    [
      empreinte(jeton),
      utilisateurId,
      expireLe,
      contexte.adresseIp ?? null,
      contexte.navigateur ?? null,
    ]
  );

  return { jeton, expireLe };
}

/**
 * Résout un jeton en session active. Une seule requête : la validité de la
 * session, l'existence de l'utilisateur et son activation se vérifient
 * ensemble, sinon un compte désactivé resterait connecté jusqu'à expiration.
 */
export async function resoudreSession(jeton: string): Promise<SessionActive | null> {
  const { rows } = await pool.query<{
    session_id: string;
    id: string;
    nom: string;
    prenom: string;
    email: string;
    role: Utilisateur["role"];
    etablissement_id: string | null;
    actif: boolean;
  }>(
    `SELECT s.id AS session_id,
            u.id, u.nom, u.prenom, u.email, u.role, u.etablissement_id, u.actif
     FROM sessions s
     JOIN utilisateurs u ON u.id = s.utilisateur_id
     WHERE s.jeton_hash = $1 AND s.expire_le > now() AND u.actif = TRUE`,
    [empreinte(jeton)]
  );

  if (rows.length === 0) {
    return null;
  }

  const ligne = rows[0];
  return {
    sessionId: ligne.session_id,
    utilisateur: {
      id: ligne.id,
      nom: ligne.nom,
      prenom: ligne.prenom,
      email: ligne.email,
      role: ligne.role,
      etablissement_id: ligne.etablissement_id,
      actif: ligne.actif,
    },
  };
}

/**
 * Prolonge une session encore active. Appelé au plus une fois par heure : une
 * écriture à chaque requête ferait de la table `sessions` le point chaud de la
 * base pour un gain nul.
 */
export async function prolongerSession(sessionId: string): Promise<void> {
  await pool.query(
    `UPDATE sessions
     SET derniere_activite = now(),
         expire_le = now() + interval '${DUREE_HEURES} hours'
     WHERE id = $1 AND derniere_activite < now() - interval '1 hour'`,
    [sessionId]
  );
}

export async function fermerSession(sessionId: string): Promise<void> {
  await pool.query(`DELETE FROM sessions WHERE id = $1`, [sessionId]);
}

/** Révoque toutes les sessions d'un compte (désactivation, mot de passe changé). */
export async function fermerSessionsDe(utilisateurId: string): Promise<void> {
  await pool.query(`DELETE FROM sessions WHERE utilisateur_id = $1`, [utilisateurId]);
}

/** Purge des sessions expirées, appelée au démarrage puis périodiquement. */
export async function purgerSessionsExpirees(): Promise<number> {
  const { rowCount } = await pool.query(`DELETE FROM sessions WHERE expire_le < now()`);
  return rowCount ?? 0;
}
