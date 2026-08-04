import { createApp } from "./app";
import { config, validerConfigurationDemarrage } from "./config";
import { pool } from "./db";

validerConfigurationDemarrage();

const app = createApp();

const server = app.listen(config.port, () => {
  console.log(`Serveur démarré sur http://localhost:${config.port}`);
});

/**
 * Arrêt propre : on cesse d'accepter de nouvelles connexions, on laisse les
 * requêtes en cours se terminer, puis on ferme le pool Postgres. Sans cela,
 * un redéploiement peut interrompre une génération en cours d'écriture et
 * laisser des connexions ouvertes côté base.
 */
function arretPropre(signal: string) {
  console.log(`${signal} reçu, arrêt en cours…`);
  server.close(async () => {
    await pool.end();
    process.exit(0);
  });

  // Filet de sécurité : si une requête ne se termine jamais, on n'attend pas
  // indéfiniment que l'hébergeur nous tue.
  setTimeout(() => process.exit(1), 10_000).unref();
}

process.on("SIGTERM", () => arretPropre("SIGTERM"));
process.on("SIGINT", () => arretPropre("SIGINT"));
