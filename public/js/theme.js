/**
 * Thème clair ou sombre.
 *
 * Le parti pris précédent — une seule apparence, claire — visait la lisibilité
 * partagée d'un écran vidéoprojeté en réunion. Il datait d'avant l'application
 * installée sur un téléphone, où l'outil sert le soir, en service, à côté
 * d'applications qui suivent toutes le réglage du système.
 *
 * Trois valeurs : « systeme » (le défaut), « clair », « sombre ». La feuille de
 * style fait le reste : sans attribut elle suit `prefers-color-scheme`, avec
 * l'attribut elle obéit.
 *
 * Le choix est retenu dans `localStorage`. Le projet écarte par principe le
 * stockage du navigateur — mais il l'écarte **pour les données de santé**, qu'il
 * ne veut pas déposer sur le disque d'un poste partagé. Une préférence
 * d'apparence n'en est pas, et elle n'a rien à faire au serveur : en version
 * locale il n'y en a pas, et en version serveur ce réglage ne concerne que
 * l'appareil devant lequel on est assis. La distinction est ici pour qu'elle ne
 * se perde pas.
 */
const CLE = "educsp-theme";
const VALEURS = ["systeme", "clair", "sombre"];

/** Ce que la barre d'état du téléphone doit afficher, par thème effectif. */
const TEINTE = { clair: "#f2eae0", sombre: "#151210" };

export function themeChoisi() {
  try {
    const retenu = localStorage.getItem(CLE);
    return VALEURS.includes(retenu) ? retenu : "systeme";
  } catch {
    // Navigation privée, stockage refusé : le thème du système fait très bien
    // l'affaire, et ce n'est pas une panne.
    return "systeme";
  }
}

/** Le thème réellement appliqué, une fois le système consulté. */
export function themeEffectif() {
  const choix = themeChoisi();
  if (choix !== "systeme") return choix;
  return matchMedia("(prefers-color-scheme: dark)").matches ? "sombre" : "clair";
}

/**
 * Aligne la barre d'état du système sur ce qui est réellement affiché.
 *
 * Les deux balises `theme-color` de la page portent chacune une media query :
 * elles suffisent tant que le thème suit le système. Dès qu'il est forcé, elles
 * disent l'inverse de ce qu'on voit — un bandeau clair au-dessus d'une
 * application sombre.
 */
function majBarreDeStatut(effectif) {
  const teinte = TEINTE[effectif];
  if (!teinte) return;
  for (const balise of document.querySelectorAll('meta[name="theme-color"]')) {
    balise.setAttribute("content", teinte);
    balise.removeAttribute("media");
  }
}

/**
 * Applique le thème retenu. À appeler au chargement du module, avant tout
 * affichage : posé après la première peinture, le changement se verrait.
 */
export function appliquerTheme(choix = themeChoisi()) {
  const racine = document.documentElement;
  if (choix === "systeme") {
    delete racine.dataset.theme;
  } else {
    racine.dataset.theme = choix;
  }
  // Tant que le système décide, les deux balises de la page suffisent et
  // continuent de suivre un changement de réglage sans que la page recharge.
  if (choix !== "systeme") majBarreDeStatut(choix);
  return choix;
}

export function choisirTheme(choix) {
  const valeur = VALEURS.includes(choix) ? choix : "systeme";
  try {
    if (valeur === "systeme") localStorage.removeItem(CLE);
    else localStorage.setItem(CLE, valeur);
  } catch {
    /* Le choix vaut pour cette session, faute de pouvoir être retenu. */
  }
  return appliquerTheme(valeur);
}

// Appliqué à l'import, et non depuis l'amorçage : le module est annoncé en
// `modulepreload`, il s'exécute donc avant la première peinture de
// l'application.
appliquerTheme();
