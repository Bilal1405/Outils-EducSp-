/**
 * Restaure une sauvegarde exportée depuis l'interface (Réglages ▸
 * Établissement ▸ Télécharger la sauvegarde) dans une base vide.
 *
 *   node scripts/restaurer-sauvegarde.mjs sauvegarde-bilans-2026-08-19.json
 *
 * Ce script existe parce qu'une sauvegarde qu'on n'a jamais restaurée n'est
 * pas une sauvegarde, c'est un fichier. Le chemin de retour doit être écrit,
 * essayé, et essayable de nouveau le jour où il servira pour de bon — ce
 * jour-là, personne n'aura le temps d'inventer la procédure.
 *
 * Ce qui n'est pas restauré, et pourquoi :
 *
 *  - les mots de passe. Ils ne sont pas dans la sauvegarde, délibérément (cf.
 *    src/services/sauvegardeService.ts). Les comptes sont recréés inactifs
 *    côté connexion : un administrateur leur redonne un mot de passe ensuite ;
 *  - le journal d'audit est réinséré tel quel, sans son identifiant d'origine :
 *    c'est une trace, pas une donnée à laquelle on se réfère par clé.
 *
 * La base cible doit être migrée (`npm run migrate`) et vide de tout
 * établissement. Le script refuse d'écrire par-dessus des données existantes :
 * une restauration par erreur sur une base en service serait pire que la panne
 * qu'elle prétend réparer.
 */
import "dotenv/config";
import { readFile } from "node:fs/promises";
import pg from "pg";

const { Pool } = pg;

const fichier = process.argv[2];
if (!fichier) {
  console.error(
    "Usage : node scripts/restaurer-sauvegarde.mjs <fichier-de-sauvegarde.json>"
  );
  process.exit(1);
}

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL absente : renseignez-la dans .env.");
  process.exit(1);
}

const sauvegarde = JSON.parse(await readFile(fichier, "utf8"));
if (sauvegarde.version !== 1) {
  console.error(
    `Version de sauvegarde inconnue : ${sauvegarde.version}. Ce script lit la version 1.`
  );
  process.exit(1);
}

const pool = new Pool({ connectionString: url });
const client = await pool.connect();

async function restaurer() {
  // Le contrôle porte sur les données, pas sur les établissements : une base
  // fraîchement migrée en contient déjà un — celui que sème la migration 004
  // pour rattacher d'anciennes lignes. Compter les établissements refuserait
  // donc précisément la base sur laquelle on veut restaurer.
  const { rows } = await client.query(
    `SELECT (SELECT count(*) FROM patients)
          + (SELECT count(*) FROM bilans)
          + (SELECT count(*) FROM utilisateurs) AS n`
  );
  if (Number(rows[0].n) > 0 && !process.argv.includes("--forcer")) {
    throw new Error(
      "La base cible contient déjà des dossiers. Restaurer par-dessus des " +
        "données en service les mélangerait. Utilisez une base vide, ou " +
        "--forcer en toute connaissance de cause."
    );
  }

  await client.query("BEGIN");

  const e = sauvegarde.etablissement;
  await client.query(
    `INSERT INTO etablissements (id, nom, adresse, telephone, email, quota_mensuel_bilans, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT (id) DO UPDATE SET nom = EXCLUDED.nom, adresse = EXCLUDED.adresse,
       telephone = EXCLUDED.telephone, email = EXCLUDED.email,
       quota_mensuel_bilans = EXCLUDED.quota_mensuel_bilans`,
    [e.id, e.nom, e.adresse, e.telephone, e.email, e.quota_mensuel_bilans, e.created_at]
  );

  for (const u of sauvegarde.utilisateurs) {
    await client.query(
      `INSERT INTO utilisateurs (id, nom, prenom, email, role, etablissement_id, actif, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) ON CONFLICT (id) DO NOTHING`,
      [u.id, u.nom, u.prenom, u.email, u.role, e.id, u.actif, u.created_at]
    );
  }

  for (const b of sauvegarde.beneficiaires) {
    await client.query(
      `INSERT INTO patients (id, nom, prenom, date_naissance, etablissement_id, created_at)
       VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT (id) DO NOTHING`,
      [b.id, b.nom, b.prenom, b.date_naissance, e.id, b.created_at]
    );
  }

  // Les bilans d'abord sans leur lien vers le bilan précédent : celui-ci peut
  // désigner une ligne qui n'est pas encore insérée.
  for (const bilan of sauvegarde.bilans) {
    await client.query(
      `INSERT INTO bilans (id, patient_id, etablissement_id, auteur_id, date_generation,
                           periode_debut, periode_fin, source, statut, type_bilan, contenu)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) ON CONFLICT (id) DO NOTHING`,
      [
        bilan.id, bilan.patient_id, e.id, bilan.auteur_id, bilan.date_generation,
        bilan.periode_debut, bilan.periode_fin, bilan.source, bilan.statut,
        bilan.type_bilan, JSON.stringify(bilan.contenu),
      ]
    );
  }
  for (const bilan of sauvegarde.bilans) {
    if (bilan.bilan_precedent_id) {
      await client.query(`UPDATE bilans SET bilan_precedent_id = $2 WHERE id = $1`, [
        bilan.id,
        bilan.bilan_precedent_id,
      ]);
    }
  }

  for (const q of sauvegarde.quotas) {
    await client.query(
      `INSERT INTO quota_usage (etablissement_id, mois, bilans_generes)
       VALUES ($1, $2, $3) ON CONFLICT (etablissement_id, mois) DO NOTHING`,
      [e.id, q.mois, q.bilans_generes]
    );
  }

  for (const a of sauvegarde.audit) {
    await client.query(
      `INSERT INTO audit_logs (horodatage, utilisateur_libelle, etablissement_id, action,
                               cible_type, cible_id, cible_libelle, details, adresse_ip)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        a.horodatage, a.utilisateur_libelle, e.id, a.action, a.cible_type,
        a.cible_id, a.cible_libelle, a.details ? JSON.stringify(a.details) : null,
        a.adresse_ip,
      ]
    );
  }

  await client.query("COMMIT");

  console.log(
    `Restauré depuis ${fichier} (export du ${sauvegarde.exporte_le}) :\n` +
      `  établissement   ${e.nom}\n` +
      `  utilisateurs    ${sauvegarde.utilisateurs.length}\n` +
      `  bénéficiaires   ${sauvegarde.beneficiaires.length}\n` +
      `  bilans          ${sauvegarde.bilans.length}\n` +
      `  lignes d'audit  ${sauvegarde.audit.length}\n\n` +
      "Les mots de passe ne figurent pas dans une sauvegarde : chaque compte\n" +
      "doit s'en voir attribuer un nouveau avant de pouvoir se connecter."
  );
}

try {
  await restaurer();
} catch (err) {
  await client.query("ROLLBACK").catch(() => {});
  console.error(`\n[restauration] ${err.message}\n`);
  process.exitCode = 1;
} finally {
  client.release();
  await pool.end();
}
