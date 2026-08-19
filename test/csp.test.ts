import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, it, expect } from "vitest";
import { POLITIQUE_CSP, VERSION_ONNX_RUNTIME } from "../src/securite/csp";
import { racineProjet } from "../src/chemins";

/**
 * Ces contrôles existent parce que la panne qu'ils préviennent est
 * particulièrement coûteuse à diagnostiquer : une entrée manquante ici ne
 * casse rien au démarrage, ne fait échouer aucun test fonctionnel, et se
 * manifeste chez l'éducateur par « La dictée a échoué : Failed to fetch »,
 * plusieurs écrans plus loin, sans rien dans les journaux du serveur.
 */
function directive(nom: string): string {
  const trouvee = POLITIQUE_CSP.split("; ").find((d) => d.startsWith(`${nom} `));
  if (!trouvee) throw new Error(`Directive ${nom} absente de la CSP`);
  return trouvee;
}

describe("politique de sécurité du contenu", () => {
  it("verrouille l'origine par défaut", () => {
    expect(POLITIQUE_CSP).toContain("default-src 'self'");
    expect(POLITIQUE_CSP).toContain("frame-ancestors 'none'");
    expect(POLITIQUE_CSP).toContain("base-uri 'self'");
  });

  /**
   * Les poids du modèle sont servis par redirection vers le stockage de
   * Hugging Face. Une CSP s'applique à la cible de la redirection : sans ces
   * hôtes, le téléchargement échoue en « Failed to fetch ».
   */
  it.each([
    ["huggingface.co", "https://huggingface.co"],
    ["le stockage en .hf.co", "https://*.hf.co"],
    ["le stockage en .huggingface.co", "https://*.huggingface.co"],
  ])("autorise %s en connexion", (_libelle, hote) => {
    expect(directive("connect-src")).toContain(hote);
  });

  it("n'autorise le moteur d'inférence que dans son dossier de version", () => {
    // Autoriser `https://cdn.jsdelivr.net` en entier laisserait n'importe quel
    // paquet du CDN s'exécuter dans une page qui affiche des données de santé.
    const scripts = directive("script-src");
    expect(scripts).toContain(
      `https://cdn.jsdelivr.net/npm/onnxruntime-web@${VERSION_ONNX_RUNTIME}/dist/`
    );
    expect(scripts).not.toMatch(/https:\/\/cdn\.jsdelivr\.net(\s|$)/);
  });

  it("permet WebAssembly sans ouvrir eval", () => {
    expect(directive("script-src")).toContain("'wasm-unsafe-eval'");
    expect(directive("script-src")).not.toContain("'unsafe-eval'");
    expect(directive("script-src")).not.toContain("'unsafe-inline'");
  });

  /**
   * La version autorisée n'est pas choisie par nous : transformers.js
   * construit l'URL à partir de la version figée dans le paquet installé. Si
   * la bibliothèque est mise à jour sans ajuster la CSP, le chargement du
   * moteur est refusé — et rien d'autre ne le signalerait.
   *
   * Le fichier est récupéré à l'installation et absent du dépôt : le contrôle
   * ne s'exécute donc que là où il est présent.
   */
  it("cible la version d'ONNX Runtime réellement embarquée", () => {
    const bibliotheque = path.join(
      racineProjet(__dirname),
      "public",
      "vendor",
      "transformers.min.js"
    );
    if (!existsSync(bibliotheque)) {
      return; // poste sans `npm run vendor:asr` : rien à comparer
    }

    const contenu = readFileSync(bibliotheque, "utf8");
    expect(
      contenu.includes(VERSION_ONNX_RUNTIME),
      `La bibliothèque embarquée ne mentionne pas ONNX Runtime ${VERSION_ONNX_RUNTIME} : ` +
        `la CSP autorise un dossier que la dictée n'ira jamais chercher. ` +
        `Relever la version dans public/vendor/transformers.min.js et corriger ` +
        `VERSION_ONNX_RUNTIME dans src/securite/csp.ts.`
    ).toBe(true);
  });
});
