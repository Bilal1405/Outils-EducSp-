import { Pool, types } from "pg";
import { config } from "./config";

// OID 1082 = DATE. pg-node parse la colonne en `Date` locale par défaut, ce
// qui décale le jour affiché d'une unité selon le fuseau horaire du serveur
// une fois reconverti en ISO (ex: 2024-01-01 → "2023-12-31T23:00:00.000Z").
// On garde la chaîne brute "YYYY-MM-DD" renvoyée par Postgres.
types.setTypeParser(1082, (value) => value);

export const pool = new Pool({ connectionString: config.databaseUrl });
