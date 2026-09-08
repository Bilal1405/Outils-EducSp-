import { pool } from "../db";

/**
 * Sauvegarde d'un établissement, sous une forme que l'on peut emporter.
 *
 * Ce que remplaçait ce service : un script qui écrivait un fichier dans le
 * dossier de l'application. Sur un poste, c'est une vraie sauvegarde ; sur un
 * hébergeur, le conteneur est recréé à chaque déploiement et le fichier
 * disparaît avec lui. Autrement dit, l'instance en ligne n'avait aucune
 * sauvegarde, et personne ne pouvait s'en apercevoir avant d'en avoir besoin.
 *
 * L'export part donc vers le navigateur du coordinateur, qui le range où sa
 * structure l'a décidé. C'est manuel, et c'est un défaut assumé : le rendre
 * automatique demanderait un stockage externe, donc des identifiants, donc un
 * tiers de plus à qui confier des données de santé. En attendant, l'interface
 * rappelle la date du dernier export plutôt que de laisser croire que quelque
 * chose se fait tout seul.
 *
 * Le format est du JSON explicite plutôt qu'un `pg_dump` : il se relit sans
 * PostgreSQL, se restaure dans une base vide par `scripts/restaurer-sauvegarde.mjs`,
 * et survit à un changement de schéma — une colonne ajoutée ne rend pas les
 * anciennes sauvegardes illisibles.
 */
export const VERSION_SAUVEGARDE = 1;

export interface Sauvegarde {
  version: number;
  exporte_le: string;
  etablissement: Record<string, unknown>;
  utilisateurs: Record<string, unknown>[];
  beneficiaires: Record<string, unknown>[];
  bilans: Record<string, unknown>[];
  quotas: Record<string, unknown>[];
  audit: Record<string, unknown>[];
}

/**
 * Les empreintes de mots de passe sont volontairement absentes.
 *
 * Un fichier de sauvegarde circule : il est téléchargé, copié sur une clé,
 * envoyé par courriel. Y placer des empreintes, même robustes, offrirait à
 * quiconque met la main dessus le loisir de les attaquer hors ligne. Après une
 * restauration, les comptes existent mais ne peuvent pas se connecter : leurs
 * mots de passe sont à redéfinir. C'est le bon sens du compromis — les bilans
 * sont irremplaçables, un mot de passe se recrée en une minute.
 */
export async function exporterEtablissement(
  etablissementId: string
): Promise<Sauvegarde> {
  const [etablissement, utilisateurs, beneficiaires, bilans, quotas, audit] =
    await Promise.all([
      pool.query(
        `SELECT id, nom, adresse, telephone, email, quota_mensuel_bilans, created_at
         FROM etablissements WHERE id = $1`,
        [etablissementId]
      ),
      pool.query(
        `SELECT id, nom, prenom, email, role, actif, created_at
         FROM utilisateurs WHERE etablissement_id = $1 ORDER BY nom, prenom`,
        [etablissementId]
      ),
      pool.query(
        `SELECT id, nom, prenom, date_naissance, created_at
         FROM patients WHERE etablissement_id = $1 ORDER BY nom, prenom`,
        [etablissementId]
      ),
      pool.query(
        `SELECT id, patient_id, auteur_id, date_generation, periode_debut,
                periode_fin, source, statut, type_bilan, contenu, bilan_precedent_id
         FROM bilans WHERE etablissement_id = $1 ORDER BY date_generation`,
        [etablissementId]
      ),
      pool.query(
        `SELECT mois, bilans_generes FROM quota_usage
         WHERE etablissement_id = $1 ORDER BY mois`,
        [etablissementId]
      ),
      pool.query(
        `SELECT horodatage, utilisateur_libelle, action, cible_type, cible_id,
                cible_libelle, details, adresse_ip
         FROM audit_logs WHERE etablissement_id = $1 ORDER BY horodatage`,
        [etablissementId]
      ),
    ]);

  if (etablissement.rows.length === 0) {
    throw new Error("Établissement introuvable");
  }

  return {
    version: VERSION_SAUVEGARDE,
    exporte_le: new Date().toISOString(),
    etablissement: etablissement.rows[0],
    utilisateurs: utilisateurs.rows,
    beneficiaires: beneficiaires.rows,
    bilans: bilans.rows,
    quotas: quotas.rows,
    audit: audit.rows,
  };
}

/**
 * Date du dernier export, lue dans le journal d'audit — qui trace déjà
 * l'opération. Pas de colonne supplémentaire pour une information qui est
 * déjà quelque part.
 */
export async function dateDerniereSauvegarde(
  etablissementId: string
): Promise<string | null> {
  const { rows } = await pool.query<{ horodatage: string }>(
    `SELECT horodatage FROM audit_logs
     WHERE etablissement_id = $1 AND action = 'sauvegarde_exportee'
     ORDER BY horodatage DESC LIMIT 1`,
    [etablissementId]
  );
  return rows[0]?.horodatage ?? null;
}
