import { BilanSchema } from "../src/schema/bilan.schema";
import { generateBilan, BilanGenerationError } from "../src/services/bilanGenerator";
import { corpusEntries } from "./fixtures/inputs";

/**
 * Script de validation du corpus de test : envoie chaque entrée fictive au
 * moteur (fournisseur LLM configuré via LLM_PROVIDER — Cerebras par défaut,
 * nécessite CEREBRAS_API_KEY, ou Ollama en self-hosted) et vérifie
 * strictement la conformité de la sortie au schéma JSON du bilan. Les
 * échecs sont loggés en détail pour permettre l'ajustement du prompt.
 *
 * Usage : npm run validate:corpus
 */
async function main() {
  let successCount = 0;
  let failureCount = 0;

  for (const entry of corpusEntries) {
    process.stdout.write(`> ${entry.id} (${entry.description})... `);
    try {
      const bilan = await generateBilan(entry.texte);
      const result = BilanSchema.safeParse(bilan);

      if (result.success) {
        console.log("OK");
        successCount++;
      } else {
        console.log("ÉCHEC SCHÉMA");
        console.error(JSON.stringify(result.error.format(), null, 2));
        failureCount++;
      }
    } catch (err) {
      console.log("ÉCHEC GÉNÉRATION");
      if (err instanceof BilanGenerationError) {
        console.error(err.message, "\ncause:", err.cause);
      } else {
        console.error(err);
      }
      failureCount++;
    }
  }

  console.log(
    `\nRésumé : ${successCount}/${corpusEntries.length} réussites, ${failureCount} échec(s).`
  );

  if (failureCount > 0) {
    process.exitCode = 1;
  }
}

main();
