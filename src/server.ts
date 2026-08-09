import { createApp } from "./app";
import { networkInterfaces } from "node:os";
import { config, validerConfigurationDemarrage } from "./config";
import { pool } from "./db";

validerConfigurationDemarrage();

const app = createApp();

/**
 * Adresses par lesquelles ce serveur est joignable.
 *
 * Express écoute sur toutes les interfaces : la machine est donc déjà
 * accessible depuis le réseau local. Encore faut-il savoir quelle adresse
 * transmettre — « localhost » ne veut rien dire depuis un autre poste.
 */
function adressesJoignables(): string[] {
  const adresses = [`http://localhost:${config.port}`];
  for (const cartes of Object.values(networkInterfaces())) {
    for (const carte of cartes ?? []) {
      if (carte.family === "IPv4" && !carte.internal) {
        adresses.push(`http://${carte.address}:${config.port}`);
      }
    }
  }
  return adresses;
}

const server = app.listen(config.port, () => {
  console.log("Serveur démarré. Adresses :");
  for (const adresse of adressesJoignables()) {
    console.log(`  ${adresse}`);
  }
  if (config.env !== "production") {
    console.log(
      "\nDepuis un autre poste, en HTTP : la dictée vocale ne fonctionnera pas\n" +
        "(le navigateur réserve le micro aux origines sécurisées) et les mots de\n" +
        "passe circulent en clair sur le réseau. Pour un usage réel, déployez\n" +
        "derrière HTTPS."
    );
  }
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
