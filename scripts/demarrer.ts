import "dotenv/config";
import { appliquerMigrations, BaseInjoignable } from "./migrate";

/**
 * Démarrage de l'application en production.
 *
 * Le démarrage enchaînait `migrate && start` : une base injoignable arrêtait la
 * séquence au premier ordre, et rien ne démarrait. L'utilisateur n'obtenait
 * alors qu'une page d'erreur de l'hébergeur — pas `/health`, pas
 * `/diagnostic.html`, c'est-à-dire précisément les deux pages faites pour dire
 * ce qui ne va pas. La panne la mieux instrumentée du projet était la seule
 * qu'on ne pouvait pas observer.
 *
 * D'où deux issues distinctes, selon ce qui a échoué :
 *
 *  - **base injoignable** : c'est l'environnement qui manque, pas
 *    l'application. On démarre quand même, en état dégradé — le diagnostic
 *    répond, `/health` nomme la cause, et les migrations sont reprises en fond
 *    jusqu'à ce que la base revienne ;
 *  - **migration refusée** : le schéma est à moitié posé. On s'arrête. Servir
 *    des requêtes sur une base dans un état indéterminé serait pire que ne
 *    rien servir du tout.
 */

/** Intervalles entre deux reprises, en minutes, le dernier étant répété. */
const REPRISES_MIN = [1, 2, 5, 10, 30];

async function reprendreLesMigrations(): Promise<void> {
  for (let essai = 0; ; essai++) {
    const attente = REPRISES_MIN[Math.min(essai, REPRISES_MIN.length - 1)];
    await new Promise((resoudre) => setTimeout(resoudre, attente * 60_000));

    try {
      await appliquerMigrations();
      console.log(
        "[démarrage] la base est revenue et le schéma est à jour : " +
          "l'application est de nouveau pleinement opérationnelle."
      );
      return;
    } catch (err) {
      if (err instanceof BaseInjoignable) {
        console.warn("[démarrage] base toujours injoignable, nouvelle reprise plus tard.");
        continue;
      }
      // Une migration refusée alors que le serveur tourne déjà : on ne peut
      // plus s'arrêter proprement sans couper des requêtes en cours, mais il
      // faut que ce soit visible dans les journaux et que la reprise cesse.
      console.error(
        "[démarrage] la base répond mais une migration a été refusée. " +
          "Le schéma est incomplet, l'application ne fonctionnera pas " +
          "correctement tant que ce n'est pas corrigé :",
        err
      );
      return;
    }
  }
}

async function main() {
  try {
    await appliquerMigrations();
  } catch (err) {
    if (!(err instanceof BaseInjoignable)) {
      console.error("Échec des migrations:", err);
      process.exit(1);
    }
    console.error(`\n${err.message}\n`);
    console.error(
      "[démarrage] l'application démarre quand même, en état dégradé :\n" +
        "  - /diagnostic.html reste consultable et nommera la panne ;\n" +
        '  - /health répond « status: degraded » avec le détail ;\n' +
        "  - aucune donnée ne peut être lue ni enregistrée d'ici là.\n" +
        "Les migrations seront reprises automatiquement dès que la base répondra."
    );
    void reprendreLesMigrations();
  }

  // Import différé, et non en tête de fichier : le serveur se met à écouter
  // dès qu'il est chargé, et il ne doit le faire qu'une fois les migrations
  // traitées — sans quoi une requête pourrait précéder son propre schéma.
  await import("../src/server");
}

main();
