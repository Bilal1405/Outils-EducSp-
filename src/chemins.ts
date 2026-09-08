import { existsSync } from "node:fs";
import path from "node:path";

/**
 * Racine du projet, quelle que soit la manière dont le code s'exécute.
 *
 * En développement, `tsx` exécute les sources : `__dirname` vaut `src/` ou
 * `scripts/`, et remonter d'un cran suffit. Compilé, le même code vit dans
 * `dist/src/` ou `dist/scripts/` : il faut remonter de deux. Un chemin relatif
 * écrit en dur est donc juste dans un mode et faux dans l'autre — c'est ce qui
 * rendait `public/` et le dossier de migrations introuvables en production,
 * sans que rien ne le signale en développement.
 *
 * On remonte jusqu'au `package.json`, ce qui donne le même résultat dans les
 * deux cas et ne dépend pas du répertoire courant.
 */
export function racineProjet(depuis: string): string {
  let dossier = depuis;

  for (let remontees = 0; remontees < 8; remontees += 1) {
    if (existsSync(path.join(dossier, "package.json"))) {
      return dossier;
    }
    const parent = path.dirname(dossier);
    if (parent === dossier) {
      break;
    }
    dossier = parent;
  }

  throw new Error(
    `Racine du projet introuvable depuis ${depuis} : aucun package.json en remontant.`
  );
}
