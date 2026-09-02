import { Pool, types } from "pg";
import { config } from "./config";

/**
 * Accès à la base, quelle qu'elle soit.
 *
 * L'application a longtemps supposé un serveur PostgreSQL joignable. C'est le
 * bon choix pour un établissement, et un obstacle rédhibitoire ailleurs :
 * installer PostgreSQL demande des droits administrateur que personne n'a sur
 * un poste d'établissement verrouillé, et qu'un praticien à son compte n'a pas
 * envie d'exercer un dimanche soir.
 *
 * D'où deux moteurs derrière la même interface :
 *
 *  - `postgres://…` : un serveur, comme aujourd'hui ;
 *  - `fichier:./donnees` : PGlite, c'est-à-dire PostgreSQL compilé en
 *    WebAssembly, qui range la base dans un dossier. Rien à installer, rien à
 *    démarrer.
 *
 * Ce n'est pas un portage : c'est le même PostgreSQL. Les douze migrations du
 * projet passent telles quelles, avec leurs `ON CONFLICT`, leurs colonnes
 * JSONB et leurs `::int` — vérifié, et bordé par `test/baseEmbarquee.test.ts`.
 * Aucune requête n'a été réécrite pour l'occasion, et aucune ne devra l'être.
 */

/** Ce que le reste du code attend d'une base, et rien de plus. */
export interface ResultatRequete<T> {
  rows: T[];
  rowCount: number | null;
}

export interface BaseDeDonnees {
  query<T = Record<string, unknown>>(
    texte: string,
    parametres?: unknown[]
  ): Promise<ResultatRequete<T>>;
  /**
   * Exécute un script pouvant contenir plusieurs instructions — un fichier de
   * migration. C'est une voie distincte de `query` parce que les deux moteurs
   * la traitent différemment : une requête paramétrée ne peut porter qu'un
   * seul ordre, et PGlite le refuse explicitement.
   */
  executerScript(sql: string): Promise<void>;
  /** Exécute une suite d'ordres en tout ou rien. */
  transaction<T>(travail: (base: BaseDeDonnees) => Promise<T>): Promise<T>;
  end(): Promise<void>;
  on(evenement: "error", ecouteur: (err: Error) => void): void;
}

/**
 * OID 1082 = DATE. Les deux moteurs renvoient sinon un `Date` local, ce qui
 * décale le jour d'une unité selon le fuseau une fois reconverti en ISO
 * (2024-01-01 → « 2023-12-31T23:00:00Z »). On garde la chaîne « YYYY-MM-DD »
 * telle que PostgreSQL l'écrit.
 */
const OID_DATE = 1082;
const garderLaDate = (valeur: string) => valeur;

export const embarquee = config.databaseUrl.startsWith("fichier:");

/** Dossier de la base embarquée, tel qu'écrit après `fichier:`. */
export function dossierBaseEmbarquee(): string {
  return config.databaseUrl.slice("fichier:".length) || "./donnees";
}

// --- Serveur PostgreSQL -----------------------------------------------------

function creerPostgres(): BaseDeDonnees {
  types.setTypeParser(OID_DATE, garderLaDate);
  const pg = new Pool({ connectionString: config.databaseUrl });

  const adapter: BaseDeDonnees = {
    query: (texte, parametres) => pg.query(texte, parametres as never[]) as never,
    async executerScript(sql) {
      await pg.query(sql);
    },
    async transaction(travail) {
      const client = await pg.connect();
      try {
        await client.query("BEGIN");
        const resultat = await travail({
          query: (texte, parametres) => client.query(texte, parametres as never[]) as never,
          executerScript: async (sql) => {
            await client.query(sql);
          },
          transaction: () => {
            throw new Error("Transaction imbriquée non gérée");
          },
          end: async () => {},
          on: () => {},
        });
        await client.query("COMMIT");
        return resultat;
      } catch (err) {
        await client.query("ROLLBACK").catch(() => {});
        throw err;
      } finally {
        client.release();
      }
    },
    end: () => pg.end(),
    on: (evenement, ecouteur) => pg.on(evenement, ecouteur),
  };
  return adapter;
}

// --- Base embarquée ---------------------------------------------------------

/**
 * PGlite est publié en modules ES, alors que ce projet est en CommonJS : d'où
 * l'import dynamique, qui est de toute façon celui qu'on veut — le paquet ne
 * se charge que si l'on a demandé une base embarquée, et un déploiement
 * d'établissement n'en paie ni le poids ni le temps de chargement.
 */
async function creerEmbarquee(): Promise<BaseDeDonnees> {
  let module: typeof import("@electric-sql/pglite");
  try {
    module = (await import("@electric-sql/pglite")) as never;
  } catch {
    throw new Error(
      "DATABASE_URL demande une base embarquée, mais @electric-sql/pglite " +
        "n'est pas installé. Corriger avec : npm install @electric-sql/pglite"
    );
  }

  const pglite = await module.PGlite.create(dossierBaseEmbarquee(), {
    parsers: { [OID_DATE]: garderLaDate },
  });

  const enrober = (cible: {
    query: (t: string, p?: unknown[]) => Promise<{ rows: unknown[]; affectedRows?: number }>;
    exec: (sql: string) => Promise<unknown>;
  }): BaseDeDonnees => ({
    async query(texte, parametres) {
      const resultat = await cible.query(texte, parametres ?? []);
      return {
        rows: resultat.rows as never[],
        // PGlite nomme `affectedRows` ce que `pg` appelle `rowCount`.
        rowCount: resultat.affectedRows ?? resultat.rows.length,
      };
    },
    async executerScript(sql) {
      await cible.exec(sql);
    },
    transaction: () => {
      throw new Error("Transaction imbriquée non gérée");
    },
    end: async () => {},
    on: () => {},
  });

  return {
    ...enrober(pglite),
    transaction: (travail) => pglite.transaction((tx) => travail(enrober(tx))) as never,
    end: () => pglite.close(),
    // PGlite n'a pas de connexions inactives susceptibles de tomber : il n'y a
    // pas d'événement d'erreur à écouter.
    on: () => {},
  };
}

// --- Point d'accès unique ---------------------------------------------------

let instance: Promise<BaseDeDonnees> | null = null;
const ecouteursErreur: ((err: Error) => void)[] = [];

function base(): Promise<BaseDeDonnees> {
  if (!instance) {
    instance = embarquee
      ? creerEmbarquee()
      : Promise.resolve(creerPostgres());
    instance.then((b) => ecouteursErreur.forEach((e) => b.on("error", e)));
  }
  return instance;
}

/**
 * Façade paresseuse : la base n'est ouverte qu'à la première requête. C'est ce
 * qui permet à un moteur asynchrone à l'ouverture — PGlite doit charger son
 * WebAssembly — de se glisser derrière la même interface, sans imposer une
 * initialisation explicite à tous les appelants.
 */
export const pool: BaseDeDonnees = {
  async query(texte, parametres) {
    return (await base()).query(texte, parametres);
  },
  async executerScript(sql) {
    return (await base()).executerScript(sql);
  },
  async transaction(travail) {
    return (await base()).transaction(travail);
  },
  async end() {
    if (instance) {
      await (await instance).end();
      instance = null;
    }
  },
  on(evenement, ecouteur) {
    ecouteursErreur.push(ecouteur);
    if (instance) {
      instance.then((b) => b.on(evenement, ecouteur));
    }
  },
};

/**
 * Une connexion inactive qui tombe — redémarrage de la base, coupure réseau,
 * hébergeur qui recycle ses instances — fait émettre `error` au pool. Sans
 * écouteur, Node traite un événement `error` non géré comme une exception et
 * termine le processus : la base repart, et c'est l'application qui reste par
 * terre.
 *
 * Il n'y a rien à faire de plus que le consigner : `pg` retire lui-même le
 * client fautif, et la requête suivante en ouvrira un neuf.
 */
pool.on("error", (err) => {
  // eslint-disable-next-line no-console
  console.error("[base] connexion inactive perdue", err.message);
});
