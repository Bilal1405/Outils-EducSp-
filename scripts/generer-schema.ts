/**
 * Publie les trames de bilan dans un module JavaScript, pour le navigateur.
 *
 * `/api/schema/bilan` et `/api/schema/modeles` ne dépendent ni de la session ni
 * de la base : ce sont des dérivations du code, identiques pour tout le monde
 * et pour toute la durée de vie d'une version. Le serveur les sert figées.
 *
 * Une application installée sur un téléphone doit pouvoir ouvrir un bilan sans
 * réseau. Elle a donc besoin des mêmes données, en local — mais surtout pas
 * d'une seconde définition écrite à la main : `modelesBilan.ts` reste la source
 * unique, d'où le formulaire guidé, la validation et l'export .docx sont tous
 * dérivés. Ce fichier est produit à partir d'elle, et
 * `test/routeurLocal.test.ts` refuse une copie périmée.
 *
 *   npm run generer:schema
 */
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  DOMAINES_COMPETENCE,
  TYPES_COMPORTEMENT,
  FREQUENCES_COMPORTEMENT,
} from "../src/schema/bilan.schema";
import { MODELES, LIBELLES_TYPE_BILAN, TYPES_BILAN } from "../src/schema/modelesBilan";

const DESTINATION = path.join("public", "js", "local", "schema.js");

export function construireModule(): string {
  const schemaBilan = {
    domaines_competence: DOMAINES_COMPETENCE,
    types_comportement: TYPES_COMPORTEMENT,
    frequences_comportement: FREQUENCES_COMPORTEMENT,
  };
  const modeles = {
    types: TYPES_BILAN.map((type) => ({ type, libelle: LIBELLES_TYPE_BILAN[type] })),
    modeles: MODELES,
  };

  return (
    `/**\n` +
    ` * Trames de bilan, pour la base locale du navigateur.\n` +
    ` *\n` +
    ` * FICHIER GÉNÉRÉ — ne pas modifier à la main.\n` +
    ` * Source : src/schema/. Régénérer avec : npm run generer:schema\n` +
    ` *\n` +
    ` * Ce que le serveur publie sur /api/schema/bilan et /api/schema/modeles,\n` +
    ` * mot pour mot : sans réseau, un praticien doit pouvoir ouvrir un bilan.\n` +
    ` */\n\n` +
    `export const SCHEMA_BILAN = ${JSON.stringify(schemaBilan, null, 2)};\n\n` +
    `export const MODELES_BILAN = ${JSON.stringify(modeles, null, 2)};\n`
  );
}

async function main() {
  const contenu = construireModule();
  await mkdir(path.dirname(DESTINATION), { recursive: true });
  await writeFile(DESTINATION, contenu, "utf8");
  console.log(
    `Trames écrites dans ${DESTINATION} (${(contenu.length / 1024).toFixed(1)} Kio).`
  );
}

if (require.main === module) {
  main().catch((err) => {
    console.error("Échec de la génération :", err.message);
    process.exit(1);
  });
}
