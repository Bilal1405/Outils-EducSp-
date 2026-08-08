import { pool } from "../db";

/**
 * Journal d'audit.
 *
 * Écrit sans bloquer la réponse : une panne du journal ne doit pas empêcher
 * un éducateur de travailler, mais elle doit se voir dans les logs du serveur.
 * Ce compromis est assumé — l'alternative, refuser l'action quand le journal
 * échoue, transformerait un incident d'écriture en interruption de service.
 */

export const ACTIONS = [
  "connexion",
  "connexion_refusee",
  "deconnexion",
  "initialisation",
  "beneficiaire_cree",
  "beneficiaire_modifie",
  "beneficiaire_supprime",
  "beneficiaire_consulte",
  "bilan_ouvert",
  "bilan_genere",
  "bilan_consulte",
  "bilan_modifie",
  "bilan_valide",
  "bilan_exporte",
  "utilisateur_cree",
  "utilisateur_desactive",
  "mot_de_passe_change",
  "reformulation",
] as const;

export type ActionAudit = (typeof ACTIONS)[number];

export interface EntreeAudit {
  action: ActionAudit;
  utilisateurId?: string | null;
  utilisateurLibelle?: string | null;
  etablissementId?: string | null;
  cibleType?: string;
  cibleId?: string;
  cibleLibelle?: string;
  details?: Record<string, unknown>;
  adresseIp?: string;
}

export async function journaliser(entree: EntreeAudit): Promise<void> {
  try {
    await pool.query(
      `INSERT INTO audit_logs
         (utilisateur_id, utilisateur_libelle, etablissement_id, action,
          cible_type, cible_id, cible_libelle, details, adresse_ip)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        entree.utilisateurId ?? null,
        entree.utilisateurLibelle ?? null,
        entree.etablissementId ?? null,
        entree.action,
        entree.cibleType ?? null,
        entree.cibleId ?? null,
        entree.cibleLibelle ?? null,
        entree.details ? JSON.stringify(entree.details) : null,
        entree.adresseIp ?? null,
      ]
    );
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("[audit] écriture impossible", entree.action, err);
  }
}

export interface LigneAudit {
  id: string;
  horodatage: string;
  utilisateur_libelle: string | null;
  action: ActionAudit;
  cible_type: string | null;
  cible_libelle: string | null;
  adresse_ip: string | null;
}

/**
 * Journal d'un établissement, du plus récent au plus ancien. Toujours borné
 * par l'établissement de la session : le journal d'audit est lui-même une
 * donnée sensible.
 */
export async function listerAudit(
  etablissementId: string,
  limite = 200
): Promise<LigneAudit[]> {
  const { rows } = await pool.query<LigneAudit>(
    `SELECT id::text, horodatage, utilisateur_libelle, action,
            cible_type, cible_libelle, adresse_ip
     FROM audit_logs
     WHERE etablissement_id = $1
     ORDER BY horodatage DESC
     LIMIT $2`,
    [etablissementId, Math.min(limite, 1000)]
  );
  return rows;
}
