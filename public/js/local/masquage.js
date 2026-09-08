/**
 * Retirer les noms d'un compte-rendu avant qu'il ne quitte l'appareil.
 *
 * La version installée sur téléphone garde les dossiers sur l'appareil ; c'est
 * ce qui la dispense d'hébergeur agréé. Un modèle de langage, lui, est ailleurs :
 * la rédaction assistée est le seul moment où quelque chose sort. Ce module
 * décide ce qui sort.
 *
 * **Ce qu'il fait, et rien de plus.** Il remplace les noms que la base connaît
 * réellement — le bénéficiaire, les autres bénéficiaires du dossier, l'auteur,
 * le nom de l'activité — par des jetons courts, puis les remet en place dans la
 * réponse. C'est déterministe : aucune reconnaissance d'entités, aucune
 * devinette. Un outil qui *croit* reconnaître un nom en manque, et donne une
 * assurance qui n'a pas lieu d'être.
 *
 * **Ce qu'il ne fait pas, et qu'il faut dire.** Un prénom que la base ne connaît
 * pas — un frère, un collègue, une école, une ville — n'est pas masqué. C'est à
 * cela que sert l'aperçu montré avant le premier envoi : il donne à lire ce qui
 * part, plutôt qu'à croire ce qu'on affirme.
 *
 * Rappel qui vaut d'être écrit : un texte pseudonymisé reste une donnée
 * personnelle au sens du RGPD (art. 4·5). Le masquage réduit le risque, il ne
 * transforme pas la nature de ce qui circule.
 */
/**
 * Sous cette longueur, on ne remplace pas.
 *
 * Un nom de deux lettres — « Li », « Bo » — se retrouverait au milieu d'autres
 * mots et hacherait le texte au point de le rendre incompréhensible au modèle.
 * Le compromis est assumé : mieux vaut un nom court non masqué, visible dans
 * l'aperçu, qu'un compte-rendu criblé de jetons.
 */
const LONGUEUR_MIN = 3;

/** Découpe un nom composé : « Jean-Baptiste Le Guen » → ses parties utiles. */
function morceaux(nom) {
  return String(nom || "")
    .split(/[\s'’-]+/)
    .map((m) => m.trim())
    .filter((m) => m.length >= LONGUEUR_MIN);
}

/**
 * Toutes les écritures d'un nom qu'on veut attraper, du plus long au plus court.
 *
 * L'ordre compte : « Jean-Baptiste » doit passer avant « Jean », sans quoi le
 * remplacement du prénom laisserait « [B1]-Baptiste » derrière lui.
 */
function ecritures(prenom, nom) {
  const complet = [prenom, nom].filter(Boolean).join(" ").trim();
  const toutes = new Set();
  if (complet) toutes.add(complet);
  if (prenom && nom) toutes.add(`${nom} ${prenom}`.trim());
  for (const partie of [...morceaux(prenom), ...morceaux(nom)]) {
    toutes.add(partie);
  }
  return [...toutes].sort((a, b) => b.length - a.length);
}

/**
 * Variantes accentuées, par lettre de base.
 *
 * L'insensibilité aux accents ne peut pas se faire en normalisant le texte :
 * retirer les diacritiques change sa longueur, et les positions trouvées ne
 * désigneraient plus rien dans l'original. On élargit donc le motif lettre à
 * lettre, ce qui laisse le texte intact.
 */
const VARIANTES = {
  a: "aàáâãäå",
  c: "cç",
  e: "eéèêë",
  i: "iíìîï",
  n: "nñ",
  o: "oóòôõö",
  u: "uúùûü",
  y: "yýÿ",
};

const SANS_ACCENT = new Map();
for (const [base, lettres] of Object.entries(VARIANTES)) {
  for (const lettre of lettres) SANS_ACCENT.set(lettre, base);
}

/** Une lettre → la classe de toutes ses écritures ; le reste → échappé. */
function classe(caractere) {
  const base = SANS_ACCENT.get(caractere.toLowerCase()) ?? caractere.toLowerCase();
  const variantes = VARIANTES[base];
  if (variantes) return `[${variantes}]`;
  return caractere.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Construit le motif d'un nom : insensible à la casse et aux accents, et borné
 * par des non-lettres pour ne pas mordre à l'intérieur d'un mot.
 *
 * `\b` ne suffit pas : il traite « é » comme une frontière de mot, et
 * « André » se ferait couper en deux. On borne donc explicitement sur ce qui
 * n'est pas une lettre.
 */
function motif(expression) {
  const parties = expression
    .split(/[\s'’-]+/)
    .filter(Boolean)
    .map((partie) => [...partie].map(classe).join(""))
    // Un nom composé peut s'écrire avec un espace, un trait d'union ou une
    // apostrophe : « Le Guen », « Le-Guen ».
    .join("[\\s'’-]+");
  return new RegExp(`(^|[^\\p{L}])(${parties})(?=[^\\p{L}]|$)`, "giu");
}

/**
 * Prépare un texte pour l'envoi.
 *
 * @param {string} texte le compte-rendu tel que l'éducateur l'a écrit
 * @param {{beneficiaire?: object, autres?: object[], auteur?: object,
 *          activite?: string}} connus ce que la base sait
 * @returns {{texte: string, table: Record<string, string>}} le texte masqué et
 *   la table qui permettra de remettre les noms en place
 */
export function preparerEnvoi(texte, connus = {}) {
  const substitutions = construireTable(connus);
  return { texte: appliquer(texte, substitutions), table: substitutions };
}

/**
 * La table des substitutions, dans l'ordre où elles doivent s'appliquer.
 *
 * Jetons courts et sans espace : le modèle les recopie tels quels dans sa
 * réponse, là où un « [BÉNÉFICIAIRE 1] » se ferait reformuler ou tronquer.
 */
export function construireTable({ beneficiaire, autres = [], auteur, activite } = {}) {
  /** @type {{motif: RegExp, jeton: string, valeur: string}[]} */
  const entrees = [];
  /** @type {Record<string, string>} */
  const table = {};

  const ajouter = (jeton, prenom, nom) => {
    const valeur = [prenom, nom].filter(Boolean).join(" ").trim();
    if (!valeur) return;
    table[jeton] = valeur;
    for (const expression of ecritures(prenom, nom)) {
      entrees.push({ motif: motif(expression), jeton, longueur: expression.length });
    }
  };

  if (beneficiaire) ajouter("[B1]", beneficiaire.prenom, beneficiaire.nom);
  autres.forEach((personne, index) =>
    ajouter(`[B${index + 2}]`, personne.prenom, personne.nom)
  );
  if (auteur) ajouter("[E1]", auteur.prenom, auteur.nom);
  if (activite) ajouter("[A1]", activite, "");

  // Du plus long au plus court, toutes personnes confondues : deux frères et
  // sœurs peuvent partager un nom de famille, et le nom complet doit l'emporter.
  entrees.sort((a, b) => b.longueur - a.longueur);
  return { entrees, table };
}

/** Applique une table à un texte. */
export function appliquer(texte, table) {
  const entrees = Array.isArray(table) ? table : table.entrees;
  let resultat = String(texte ?? "");
  for (const entree of entrees ?? []) {
    resultat = resultat.replace(entree.motif, (_tout, avant) => `${avant}${entree.jeton}`);
  }
  return resultat;
}

/**
 * Remet les noms dans ce que le modèle a rendu.
 *
 * Parcourt chaînes, tableaux et objets : le bilan est une structure, pas un
 * texte, et un jeton oublié au fond d'une section serait lu tel quel par
 * l'éducateur.
 */
export function restituer(valeur, table) {
  const noms = table && table.table ? table.table : table;
  if (typeof valeur === "string") {
    let resultat = valeur;
    for (const [jeton, nom] of Object.entries(noms ?? {})) {
      resultat = resultat.split(jeton).join(nom);
    }
    return resultat;
  }
  if (Array.isArray(valeur)) {
    return valeur.map((element) => restituer(element, table));
  }
  if (valeur && typeof valeur === "object") {
    return Object.fromEntries(
      Object.entries(valeur).map(([cle, sous]) => [cle, restituer(sous, table)])
    );
  }
  return valeur;
}

/**
 * Ce qui reste identifiable après masquage, pour l'aperçu.
 *
 * On ne prétend pas le détecter : on rappelle simplement que le masquage ne
 * porte que sur ce que la base connaît. La liste des jetons effectivement posés
 * dit, elle, ce qui a bien été retiré.
 */
export function jetonsPoses(texteMasque, table) {
  const noms = table && table.table ? table.table : table;
  return Object.keys(noms ?? {}).filter((jeton) => texteMasque.includes(jeton));
}
