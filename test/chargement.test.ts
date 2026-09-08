import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { racineProjet } from "../src/chemins";

/**
 * L'écran de chargement est la première chose que voit un praticien qui ouvre
 * l'application, et la seule qui parle quand rien n'est encore affichable. Ses
 * défaillances sont toutes silencieuses : un identifiant renommé d'un côté et
 * pas de l'autre laisse une page blanche, un échec non bloquant qui retient
 * l'écran enferme un poste sans accès à huggingface.co dans un outil dont il
 * n'a besoin que pour écrire au clavier.
 *
 * On vérifie donc le modèle lui-même, et pas seulement la présence des
 * identifiants : c'est la logique — qui bloque, qui laisse passer, quand
 * l'écran paraît — qui décide de ce que voit l'utilisateur.
 */
const racine = racineProjet(__dirname);
const lire = (...morceaux: string[]) => readFileSync(path.join(racine, ...morceaux), "utf8");

// --- Un DOM minimal ----------------------------------------------------------
// Le projet n'embarque pas de bibliothèque de DOM et n'a pas de raison d'en
// ajouter une pour un module de deux cents lignes. Ce faux couvre exactement ce
// que `chargement.js` et `ui.js` touchent, et rien de plus.

class Faux {
  className = "";
  textContent = "";
  hidden = false;
  inert = false;
  style: Record<string, string> = {};
  dataset: Record<string, string> = {};
  attributs: Record<string, string> = {};
  classes = new Set<string>();
  enfants: Faux[] = [];
  parentElement: Faux | null = null;
  focusRecu = 0;
  ecouteurs: Record<string, ((e?: unknown) => void)[]> = {};

  classList = {
    add: (c: string) => this.classes.add(c),
    remove: (c: string) => this.classes.delete(c),
    contains: (c: string) => this.classes.has(c),
    toggle: (c: string, force?: boolean) =>
      force ? this.classes.add(c) : this.classes.delete(c),
  };

  setAttribute(nom: string, valeur: string) {
    this.attributs[nom] = valeur;
  }
  removeAttribute(nom: string) {
    delete this.attributs[nom];
  }
  append(...noeuds: Faux[]) {
    for (const noeud of noeuds) {
      noeud.parentElement = this;
      this.enfants.push(noeud);
    }
  }
  replaceChildren() {
    this.enfants = [];
  }
  focus() {
    this.focusRecu += 1;
  }
  addEventListener(nom: string, gestionnaire: (e?: unknown) => void) {
    (this.ecouteurs[nom] ||= []).push(gestionnaire);
  }
  declencher(nom: string) {
    for (const gestionnaire of this.ecouteurs[nom] || []) gestionnaire();
  }
  /** Le texte rendu par cet élément et sa descendance. */
  get texte(): string {
    return this.textContent + this.enfants.map((e) => e.texte).join(" ");
  }
}

const IDENTIFIANTS = [
  "chargement",
  "chargement-titre",
  "chargement-barre",
  "chargement-taille",
  "chargement-etapes",
  "chargement-passer",
  "chargement-reessayer",
  "chargement-aide",
  "app",
  "entete",
];

let noeuds: Record<string, Faux>;

function monterDom() {
  noeuds = Object.fromEntries(IDENTIFIANTS.map((id) => [id, new Faux()]));
  // La barre demande sa jauge parente pour y poser `aria-valuenow`.
  noeuds["chargement-barre"].parentElement = new Faux();

  (globalThis as Record<string, unknown>).document = {
    getElementById: (id: string) => noeuds[id] ?? null,
    createElement: () => new Faux(),
    createElementNS: () => new Faux(),
  };
  (globalThis as Record<string, unknown>).requestAnimationFrame = (
    rappel: () => void
  ) => {
    rappel();
    return 0;
  };
}

/** Recharge le module : son état d'étapes vit au niveau du module. */
async function chargerModule() {
  vi.resetModules();
  return import("../public/js/chargement.js" as string);
}

describe("modèle d'étapes", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    monterDom();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("n'affiche rien sous le seuil de quatre cents millisecondes", async () => {
    const { suivre, etatChargement } = await chargerModule();

    const etape = suivre("base", "Base de données", { bloquante: true });
    vi.advanceTimersByTime(399);
    expect(etatChargement().affiche).toBe(false);

    // Au deuxième lancement, tout est en cache et la séquence dure moins d'une
    // seconde : un écran affiché puis retiré aussitôt serait un clignotement.
    etape.reussir();
    vi.advanceTimersByTime(1000);
    expect(etatChargement().affiche).toBe(false);
  });

  it("n'attend aucune minuterie quand l'étape monopolise le fil principal", async () => {
    const { suivre, etatChargement } = await chargerModule();

    // Mesuré : la minuterie de 400 ms armée juste avant l'ouverture de PGlite
    // ne se déclenchait qu'à 3,1 s, le temps que le WebAssembly se compile —
    // trois secondes de page vide, ce que cet écran existe pour éviter.
    suivre("base", "Base de données", { bloquante: true, immediat: true });
    expect(etatChargement().affiche).toBe(true);
    expect(noeuds["chargement"].hidden).toBe(false);
  });

  it("paraît quand l'attente se prolonge, et se retire seule", async () => {
    const { suivre, etatChargement } = await chargerModule();

    const etape = suivre("base", "Base de données", { bloquante: true });
    vi.advanceTimersByTime(400);
    expect(etatChargement().affiche).toBe(true);
    expect(noeuds["chargement"].hidden).toBe(false);
    // L'application peinte dessous ne doit rester ni tabulable ni lisible par
    // un lecteur d'écran.
    expect(noeuds["app"].inert).toBe(true);

    etape.reussir();
    expect(etatChargement().affiche).toBe(false);
    expect(noeuds["chargement"].hidden).toBe(true);
    expect(noeuds["app"].inert).toBe(false);
  });

  it("ne propose aucune sortie tant qu'une étape bloquante travaille", async () => {
    const { suivre } = await chargerModule();

    suivre("base", "Base de données", { bloquante: true });
    vi.advanceTimersByTime(400);
    // Sans base, l'application n'a rien à montrer : « continuer » mentirait.
    expect(noeuds["chargement-passer"].hidden).toBe(true);
    expect(noeuds["chargement-reessayer"].hidden).toBe(true);
  });

  it("laisse toujours une sortie quand seule la dictée est en cours", async () => {
    const { suivre } = await chargerModule();

    suivre("base", "Base de données", { bloquante: true }).reussir();
    suivre("dictee", "Moteur de dictée");
    vi.advanceTimersByTime(400);

    // Un poste sans accès à huggingface.co doit rester capable d'écrire au
    // clavier : c'est la règle, et elle ne se durcit pas.
    expect(noeuds["chargement-passer"].hidden).toBe(false);
    expect(noeuds["chargement-passer"].focusRecu).toBeGreaterThan(0);
  });

  it("garde l'écran sur un échec non bloquant, puis obéit à l'écart", async () => {
    const { suivre, initChargement, etatChargement } = await chargerModule();
    initChargement();

    suivre("dictee", "Moteur de dictée").echouer("Le modèle est introuvable.");
    vi.advanceTimersByTime(400);

    // Sans cela, la seule occasion de dire pourquoi la dictée ne marchera pas
    // sur ce poste disparaîtrait en une image.
    expect(etatChargement().affiche).toBe(true);
    expect(noeuds["chargement-etapes"].texte).toContain("Le modèle est introuvable.");
    expect(noeuds["chargement-aide"].hidden).toBe(false);
    expect(noeuds["chargement-passer"].textContent).toBe("Continuer sans la dictée");

    noeuds["chargement-passer"].declencher("click");
    expect(etatChargement().affiche).toBe(false);
  });

  it("propose une reprise sur un échec bloquant, sans attendre le seuil", async () => {
    const { suivre, initChargement, etatChargement } = await chargerModule();
    initChargement();

    let reprises = 0;
    suivre("base", "Base de données", { bloquante: true }).echouer(
      "Le moteur de base de données est absent.",
      { reessayer: () => (reprises += 1) }
    );

    // Il n'y a plus rien à espérer : autant le dire tout de suite.
    expect(etatChargement().affiche).toBe(true);
    expect(noeuds["chargement-reessayer"].hidden).toBe(false);
    expect(noeuds["chargement-passer"].hidden).toBe(true);

    noeuds["chargement-reessayer"].declencher("click");
    expect(reprises).toBe(1);

    // Ni titre ni jauge ne doivent laisser croire que quelque chose progresse
    // encore : l'ouverture est perdue, il n'y a plus rien à mesurer.
    expect(noeuds["chargement-titre"].textContent).toBe("L'application n'a pas pu s'ouvrir");
    expect(noeuds["chargement-barre"].parentElement!.hidden).toBe(true);
  });

  it("ne se superpose jamais à l'écran de connexion", async () => {
    const { suivre, suspendre, reprendre, etatChargement } = await chargerModule();

    suivre("donnees", "Vos dossiers", { bloquante: true });
    vi.advanceTimersByTime(400);
    expect(etatChargement().affiche).toBe(true);

    // Le portail attend une saisie, parfois longuement.
    suspendre();
    expect(etatChargement().affiche).toBe(false);
    expect(noeuds["app"].inert).toBe(false);

    // Les étapes déjà cochées le restent : l'écran reprend où il en était.
    reprendre();
    vi.advanceTimersByTime(400);
    expect(etatChargement().affiche).toBe(true);
    expect(etatChargement().etapes.map((e: { id: string }) => e.id)).toEqual(["donnees"]);
  });

  it("distingue une étape remise à plus tard d'une étape qui traîne", async () => {
    const { suivre, etatChargement } = await chargerModule();

    suivre("dictee", "Moteur de dictée").differer("Préparé au premier usage du micro");
    vi.advanceTimersByTime(1000);

    // Sur téléphone, le modèle n'est pas téléchargé au démarrage. Sans cet
    // état, l'écran afficherait une étape qui ne démarre jamais et paraîtrait
    // bloqué.
    expect(etatChargement().affiche).toBe(false);
    expect(etatChargement().etapes[0].etat).toBe("differee");
  });
});

describe("branchement sur la page", () => {
  const page = lire("public", "index.html");

  it("ne pilote que des éléments qui existent dans la page", () => {
    // Renommer un identifiant d'un côté et pas de l'autre ne casse rien de
    // visible : `$("…")` rend `null`, l'exception part dans la console, et
    // l'écran ne s'affiche jamais. On s'en apercevrait devant une page blanche.
    const modules = [
      lire("public", "js", "chargement.js"),
      lire("public", "js", "preparation.js"),
    ].join("\n");
    const identifiants = [...modules.matchAll(/\$\("([^"]+)"\)/g)].map((m) => m[1]);

    expect(identifiants.length).toBeGreaterThan(5);
    const absents = identifiants.filter((id) => !page.includes(`id="${id}"`));
    expect(absents, `identifiants absents d'index.html : ${absents.join(", ")}`).toEqual([]);
  });

  it("couvre les trois moments où la page restait blanche", () => {
    const app = lire("public", "js", "app.js");
    // L'ouverture de la base, le chargement des dossiers, et l'intervalle entre
    // la connexion et l'apparition de l'interface.
    expect(app).toMatch(/suivre\("base"/);
    expect(app).toMatch(/suivre\("donnees"/);
    expect(app).toMatch(/suspendre\(\)/);
    expect(app).toMatch(/reprendre\(\)/);
  });

  it("charge la transcription après la session, pas avant", () => {
    // Un `modulepreload` de `/transcription.js` la ferait chercher dès
    // l'ouverture de la page, y compris par un visiteur non connecté.
    expect(page).not.toMatch(/modulepreload"\s+href="\/transcription\.js"/);
  });
});
