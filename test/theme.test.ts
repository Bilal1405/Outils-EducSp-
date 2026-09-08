import { readFileSync, globSync } from "node:fs";
import path from "node:path";
import { describe, it, expect } from "vitest";
import { racineProjet } from "../src/chemins";

/**
 * Le thème sombre échoue d'une seule façon, et elle est invisible : un jeton
 * défini dans `:root` mais oublié dans les blocs sombres garde sa valeur claire.
 * Du texte crème sur du crème, une bordure blanche sur du noir — cela ne se
 * découvre qu'en basculant, sur l'écran précis où le jeton servait, et il y en
 * a une centaine.
 *
 * Ces contrôles remplacent la relecture : les trois listes doivent coïncider, et
 * aucune couleur ne doit être écrite ailleurs qu'au milieu d'elles.
 */
const racine = racineProjet(__dirname);
const lire = (...morceaux: string[]) => readFileSync(path.join(racine, ...morceaux), "utf8");
const style = lire("public", "style.css");

/** Les déclarations `--jeton: valeur;` d'un bloc, par nom. */
function jetons(bloc: string): Map<string, string> {
  const trouves = new Map<string, string>();
  for (const [, nom, valeur] of bloc.matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+);/g)) {
    trouves.set(nom, valeur.trim());
  }
  return trouves;
}

/** Un jeton porte-t-il une couleur ? Ce sont les seuls qui doivent basculer. */
const estCouleur = (valeur: string) =>
  /^#[0-9a-f]{3,8}$/i.test(valeur) || /^(rgb|hsl|color-mix)/.test(valeur);

function bloc(depart: string): string {
  const debut = style.indexOf(depart);
  expect(debut, `bloc introuvable : ${depart}`).toBeGreaterThan(-1);
  const fin = style.indexOf("\n}", debut);
  return style.slice(debut, fin);
}

const clair = jetons(bloc(":root {"));
const systeme = jetons(bloc(':root:not([data-theme="clair"]) {'));
const force = jetons(bloc(':root[data-theme="sombre"] {'));

describe("palette sombre", () => {
  it("reprend toutes les couleurs du thème clair, sans exception", () => {
    const couleurs = [...clair].filter(([, v]) => estCouleur(v)).map(([n]) => n);
    // Un jeton non couvert n'est pas une nuance : c'est une zone illisible.
    const oublies = couleurs.filter((nom) => !systeme.has(nom));
    expect(oublies, `jetons sans valeur sombre : ${oublies.join(", ")}`).toEqual([]);
  });

  it("dit exactement la même chose selon le système et selon le réglage", () => {
    // Deux blocs identiques, faute de pouvoir en écrire un seul en CSS. Ils
    // dérivent au premier oubli, et l'un des deux chemins devient faux.
    expect([...force.keys()].sort()).toEqual([...systeme.keys()].sort());
    for (const [nom, valeur] of systeme) {
      expect(force.get(nom), `divergence sur ${nom}`).toBe(valeur);
    }
  });

  it("ne déclare aucun jeton deux fois dans le même bloc", () => {
    // Une déclaration en double passe inaperçue — la dernière gagne, et les
    // deux peuvent diverger sans que rien ne le dise.
    for (const [nom, texte] of [
      ["système", bloc(':root:not([data-theme="clair"]) {')],
      ["réglage", bloc(':root[data-theme="sombre"] {')],
      ["clair", bloc(":root {")],
    ]) {
      const noms = [...texte.matchAll(/(--[a-z0-9-]+)\s*:/g)].map((m) => m[1]);
      const doubles = noms.filter((n, i) => noms.indexOf(n) !== i);
      expect(doubles, `jetons déclarés deux fois (${nom}) : ${doubles.join(", ")}`).toEqual([]);
    }
  });

  it("ne définit rien que le thème clair ne connaisse", () => {
    const inconnus = [...systeme.keys()].filter((nom) => !clair.has(nom));
    expect(inconnus, `jetons absents de :root : ${inconnus.join(", ")}`).toEqual([]);
  });

  it("laisse le navigateur suivre, y compris pour ce qu'il dessine lui-même", () => {
    // Sans `light dark`, les champs de date, les barres de défilement et
    // l'autocomplétion restent clairs au milieu d'une interface sombre.
    expect(style).toMatch(/color-scheme:\s*light dark/);
    expect(style).toMatch(/:root\[data-theme="clair"\]\s*\{\s*color-scheme:\s*light/);
    expect(style).toMatch(/:root\[data-theme="sombre"\]\s*\{\s*color-scheme:\s*dark/);
  });
});

describe("couleurs écrites en dur", () => {
  it("n'existent nulle part hors des blocs de jetons", () => {
    // Une couleur posée dans une règle ne bascule pas : elle survit au thème
    // sombre telle quelle, et c'est précisément ce qu'on ne peut pas voir.
    const corps = style.slice(style.indexOf("   2. Primitives"));
    const enDur = [...corps.matchAll(/^\s*[a-z-]*(?:color|background|border|shadow|fill|stroke)[a-z-]*:[^;]*(#[0-9a-fA-F]{3,8}|rgba?\()[^;]*;/gm)]
      .map((m) => m[0].trim());
    expect(enDur, `couleurs figées : ${enDur.join(" | ")}`).toEqual([]);
  });
});

describe("barre d'état du téléphone", () => {
  const page = lire("public", "index.html");

  it("porte une teinte par thème", () => {
    // Une seule valeur laisserait un bandeau clair au-dessus d'une application
    // sombre — sur un téléphone, c'est la moitié de ce qu'on voit.
    expect(page).toMatch(/theme-color" media="\(prefers-color-scheme: light\)"/);
    expect(page).toMatch(/theme-color" media="\(prefers-color-scheme: dark\)"/);
  });

  it("est réalignée quand le thème est forcé à la main", () => {
    // Les media queries des balises suivent le système : dès qu'on impose un
    // thème, elles disent l'inverse de ce qui est affiché.
    const theme = lire("public", "js", "theme.js");
    expect(theme).toMatch(/meta\[name="theme-color"\]/);
    expect(theme).toContain("removeAttribute(\"media\")");
  });
});

describe("choix retenu", () => {
  const theme = lire("public", "js", "theme.js");

  it("n'écrit dans le navigateur rien d'autre qu'une préférence d'apparence", () => {
    const ecritures = [...theme.matchAll(/localStorage\.(setItem|getItem|removeItem)\(([^),]+)/g)];
    expect(ecritures.length).toBeGreaterThan(0);
    for (const [, , argument] of ecritures) {
      expect(argument.trim()).toBe("CLE");
    }
    expect(theme).toMatch(/const CLE = "educsp-theme"/);
  });

  it("est la seule chose que ce projet dépose sur le disque du poste, avec deux exceptions nommées", () => {
    // Le stockage du navigateur est écarté par principe : il déposerait des
    // données de santé sur un poste partagé. Trois clés y échappent, et aucune
    // ne porte de donnée de santé — une apparence, une clé d'activation, et le
    // fait d'avoir déjà lu l'aperçu. Toute quatrième doit être discutée, pas
    // ajoutée en passant.
    const AUTORISEES: Record<string, string> = {
      "js/theme.js": "educsp-theme",
      "js/local/assistance.js": "educsp-cle-activation",
      "js/apercuEnvoi.js": "educsp-apercu-vu",
    };

    const modules = globSync("js/**/*.js", { cwd: path.join(racine, "public") });
    const fautifs = modules
      .map((chemin) => chemin.split(path.sep).join("/"))
      .filter(
        (chemin) =>
          lire("public", ...chemin.split("/")).includes("localStorage") &&
          !(chemin in AUTORISEES)
      );
    expect(fautifs, `stockage navigateur non déclaré : ${fautifs.join(", ")}`).toEqual([]);

    for (const [chemin, cle] of Object.entries(AUTORISEES)) {
      expect(lire("public", ...chemin.split("/")), chemin).toContain(`"${cle}"`);
    }
  });

  it("ne met jamais la clé d'activation dans la base ni dans une sauvegarde", () => {
    // La base part dans les sauvegardes, et un fichier de sauvegarde circule.
    // C'est la raison pour laquelle cette clé vit ailleurs.
    const assistance = lire("public", "js", "local", "assistance.js");
    expect(assistance).not.toMatch(/INSERT|UPDATE|base\.query/);
    expect(assistance).toMatch(/localStorage/);
  });

  it("survit à un stockage refusé", () => {
    // Navigation privée, ou navigateur réglé pour bloquer les données de site :
    // l'accès lève, et une exception ici empêcherait l'application de démarrer.
    expect(theme.match(/catch/g)?.length ?? 0).toBeGreaterThanOrEqual(2);
  });
});
