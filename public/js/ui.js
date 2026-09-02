/**
 * Briques d'interface partagées : construction de nœuds, icônes, notifications,
 * formatage. Aucune connaissance du domaine ici.
 */

export const $ = (id) => document.getElementById(id);

/**
 * Fabrique un élément. Les enfants `null` sont ignorés, ce qui permet
 * d'écrire des rendus conditionnels sans `if` intercalés.
 */
export function creer(balise, options = {}, enfants = []) {
  const noeud = document.createElement(balise);
  if (options.classe) noeud.className = options.classe;
  if (options.texte !== undefined && options.texte !== null) {
    noeud.textContent = options.texte;
  }
  for (const [nom, valeur] of Object.entries(options.attrs || {})) {
    if (valeur !== null && valeur !== undefined && valeur !== false) {
      noeud.setAttribute(nom, valeur === true ? "" : valeur);
    }
  }
  for (const [nom, gestionnaire] of Object.entries(options.sur || {})) {
    noeud.addEventListener(nom, gestionnaire);
  }
  for (const enfant of enfants) {
    if (enfant !== null && enfant !== undefined && enfant !== false) {
      noeud.append(enfant);
    }
  }
  return noeud;
}

/** Référence une icône du jeu embarqué dans la page (aucune requête réseau). */
export function icone(nom, classe = "ico") {
  const NS = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(NS, "svg");
  svg.setAttribute("class", classe);
  svg.setAttribute("aria-hidden", "true");
  const use = document.createElementNS(NS, "use");
  use.setAttribute("href", `#ico-${nom}`);
  svg.append(use);
  return svg;
}

export function vider(noeud) {
  noeud.replaceChildren();
}

/** Message court et transitoire. Les erreurs restent affichées plus longtemps. */
export function notifier(message, type = "info") {
  const conteneur = $("toasts");
  const noeud = creer("div", { classe: `toast ${type}` }, [
    type === "ok" ? icone("check") : null,
    type === "erreur" ? icone("alerte") : null,
    creer("span", { texte: message }),
  ]);
  conteneur.append(noeud);

  const retirer = () => {
    noeud.classList.add("toast-sortie");
    setTimeout(() => noeud.remove(), 250);
  };
  setTimeout(retirer, type === "erreur" ? 7000 : 3500);
}

/** Message inline attaché à un formulaire, là où l'action a été déclenchée. */
export function statut(cible, message, type = "") {
  cible.textContent = message || "";
  cible.className = "statut" + (type ? ` ${type}` : "");
}

// --- Formatage ---

export function formatDate(valeur) {
  if (!valeur) return "";
  const [annee, mois, jour] = String(valeur).slice(0, 10).split("-");
  if (!annee || !mois || !jour) return String(valeur);
  return `${jour}/${mois}/${annee}`;
}

export function formatDateHeure(valeur) {
  if (!valeur) return "";
  const date = new Date(valeur);
  if (Number.isNaN(date.getTime())) return String(valeur);
  return date.toLocaleDateString("fr-FR", {
    day: "2-digit",
    month: "long",
    year: "numeric",
  });
}

/** Convertit une date ISO en valeur acceptée par `<input type="date">`. */
export function versValeurDate(valeur) {
  if (!valeur) return "";
  return String(valeur).slice(0, 10);
}

export function age(dateNaissance) {
  if (!dateNaissance) return null;
  const naissance = new Date(dateNaissance);
  if (Number.isNaN(naissance.getTime())) return null;
  const aujourdhui = new Date();
  let annees = aujourdhui.getFullYear() - naissance.getFullYear();
  const moisEcart = aujourdhui.getMonth() - naissance.getMonth();
  if (moisEcart < 0 || (moisEcart === 0 && aujourdhui.getDate() < naissance.getDate())) {
    annees -= 1;
  }
  return annees >= 0 && annees < 130 ? annees : null;
}

export function initiales(prenom = "", nom = "") {
  const premier = (prenom.trim()[0] || "").toUpperCase();
  const second = (nom.trim()[0] || "").toUpperCase();
  return (premier + second) || "?";
}

/** Comparaison insensible à la casse et aux accents, pour la recherche. */
export function normaliser(texte) {
  return String(texte || "")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase();
}

export function pluriel(nombre, singulier, plurielMot) {
  return `${nombre} ${nombre > 1 ? plurielMot : singulier}`;
}
