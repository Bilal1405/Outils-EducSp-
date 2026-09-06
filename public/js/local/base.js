/**
 * La base de données, dans le navigateur du praticien.
 *
 * Version pour praticien indépendant : il n'y a pas de serveur, donc pas
 * d'hébergeur — et par conséquent ni certification HDS à obtenir, ni base
 * supprimée au bout de trente jours, ni transfert de données de santé à
 * justifier. Les dossiers ne quittent jamais l'appareil.
 *
 * Ce n'est pas une base au rabais : c'est le même PostgreSQL, compilé en
 * WebAssembly, appliquant les mêmes migrations que le serveur. Aucune requête
 * du projet n'a été réécrite pour lui, et `test/baseEmbarquee.test.ts` le
 * vérifie migration par migration.
 *
 * Ce qu'il faut savoir, et qui doit être dit à l'utilisateur plutôt que caché :
 *
 *  - la base vit dans le stockage du navigateur. Effacer les données du site,
 *    c'est effacer les dossiers ;
 *  - un téléphone perdu emporte la base avec lui. Le chiffrement du disque par
 *    Android protège tant que l'appareil est verrouillé, pas au-delà ;
 *  - la sauvegarde est donc à l'initiative de l'utilisateur, et l'interface
 *    doit la lui rappeler.
 */
import { MIGRATIONS } from "./migrations.js";

/**
 * Où PGlite range la base.
 *
 * `idb://` : IndexedDB, disponible partout et sans configuration de serveur.
 * L'alternative `opfs-ahp://` est plus rapide mais exige des en-têtes
 * d'isolation d'origine que l'application ne pose pas, et se comporte mal en
 * navigation privée. Un gain de vitesse ne vaut pas une base qui ne s'ouvre
 * pas sur un appareil.
 */
const EMPLACEMENT = "idb://outils-educsp";

const BIBLIOTHEQUE = "/vendor/pglite/index.js";

/**
 * OID 1082 = DATE. Sans ce réglage, une date revient en `Date` locale et le
 * jour se décale d'une unité selon le fuseau une fois reconvertie en ISO
 * (2024-01-01 → « 2023-12-31T23:00:00Z »). Même correctif que côté serveur ;
 * les deux doivent rester identiques, sinon un même dossier s'affiche
 * différemment selon qu'il est ouvert sur le téléphone ou sur le poste.
 */
const OID_DATE = 1082;

let instance = null;

/** Enrobe un client PGlite dans l'interface qu'attend le reste du code. */
function enrober(client) {
  return {
    async query(texte, parametres) {
      const resultat = await client.query(texte, parametres ?? []);
      return {
        rows: resultat.rows,
        // PGlite nomme `affectedRows` ce que `pg` appelle `rowCount`.
        rowCount: resultat.affectedRows ?? resultat.rows.length,
      };
    },
    async executerScript(sql) {
      await client.exec(sql);
    },
    transaction() {
      throw new Error("Transaction imbriquée non gérée");
    },
  };
}

/**
 * Applique les migrations qui manquent.
 *
 * Même table de suivi et même logique que `scripts/migrate.ts` : une migration
 * déjà appliquée est ignorée, chacune s'exécute dans sa propre transaction. La
 * base d'un praticien traverse les mises à jour de l'application comme celle
 * d'un établissement.
 */
async function appliquerMigrations(base, onEtape) {
  await base.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      name TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);

  const { rows } = await base.query("SELECT name FROM schema_migrations");
  const deja = new Set(rows.map((r) => r.name));
  const restantes = MIGRATIONS.filter((m) => !deja.has(m.nom));

  for (const [index, migration] of restantes.entries()) {
    onEtape(`Mise à jour de la base (${index + 1}/${restantes.length})…`);
    await base.transaction(async (tx) => {
      await tx.executerScript(migration.sql);
      await tx.query("INSERT INTO schema_migrations (name) VALUES ($1)", [migration.nom]);
    });
  }

  return restantes.length;
}

/**
 * Ouvre la base et la met à jour. Le résultat est mémorisé : la base n'est
 * ouverte qu'une fois par onglet.
 *
 * @param {(etape: string) => void} [onEtape] avancement affichable
 */
export function ouvrirBase(onEtape = () => {}) {
  if (instance) {
    return instance;
  }

  instance = (async () => {
    onEtape("Ouverture de la base locale…");

    let PGlite;
    try {
      ({ PGlite } = await import(BIBLIOTHEQUE));
    } catch (err) {
      throw new Error(
        "Le moteur de base de données est absent de l'application. " +
          "C'est une erreur d'installation, pas une manipulation de votre part " +
          `(${err.message}).`
      );
    }

    const client = await PGlite.create(EMPLACEMENT, {
      parsers: { [OID_DATE]: (valeur) => valeur },
    });

    const base = {
      ...enrober(client),
      transaction: (travail) => client.transaction((tx) => travail(enrober(tx))),
      fermer: () => client.close(),
    };

    const appliquees = await appliquerMigrations(base, onEtape);
    if (appliquees > 0) {
      onEtape("Base à jour.");
    }
    return base;
  })();

  // Une ouverture ratée ne doit pas condamner l'onglet : on repart de zéro au
  // prochain essai, sinon un incident passager exigerait un redémarrage.
  instance.catch(() => {
    instance = null;
  });

  return instance;
}

/**
 * Ce que le stockage du navigateur nous accorde, et où nous en sommes.
 *
 * Une base locale est la seule copie des dossiers : approcher du plafond sans
 * le savoir n'est pas acceptable. Rendu `null` quand le navigateur refuse de
 * répondre — on ne devine pas un chiffre qu'on n'a pas.
 */
export async function placeDisponible() {
  if (!navigator.storage || !navigator.storage.estimate) {
    return null;
  }
  try {
    const { quota, usage } = await navigator.storage.estimate();
    if (typeof quota !== "number") return null;
    return { utilise: usage ?? 0, total: quota };
  } catch {
    return null;
  }
}

/**
 * Demande au navigateur de ne pas effacer la base pour faire de la place.
 *
 * Sans cela, le stockage est « au mieux » : un navigateur à court d'espace
 * peut supprimer les données d'un site sans prévenir. Avec une base locale,
 * cela signifie perdre des dossiers. La demande est accordée d'office quand
 * l'application est installée sur l'écran d'accueil — raison de plus pour
 * pousser à l'installation plutôt qu'à l'usage dans un onglet.
 *
 * @returns {Promise<boolean|null>} accordé, refusé, ou indéterminable
 */
export async function protegerStockage() {
  if (!navigator.storage || !navigator.storage.persist) {
    return null;
  }
  try {
    if (await navigator.storage.persisted()) return true;
    return await navigator.storage.persist();
  } catch {
    return null;
  }
}
