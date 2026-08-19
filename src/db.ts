import { Pool, types } from "pg";
import { config } from "./config";

// OID 1082 = DATE. pg-node parse la colonne en `Date` locale par défaut, ce
// qui décale le jour affiché d'une unité selon le fuseau horaire du serveur
// une fois reconverti en ISO (ex: 2024-01-01 → "2023-12-31T23:00:00.000Z").
// On garde la chaîne brute "YYYY-MM-DD" renvoyée par Postgres.
types.setTypeParser(1082, (value) => value);

export const pool = new Pool({ connectionString: config.databaseUrl });

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
