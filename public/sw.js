/**
 * Service worker : ce qui rend l'application utilisable sans réseau.
 *
 * Pour la version installée sur le téléphone d'un praticien, ce n'est pas un
 * agrément mais la condition d'existence : la base de données est sur
 * l'appareil, il n'y a aucun serveur à joindre pour travailler. Sans cache de
 * l'interface, l'application ne s'ouvrirait pas en zone blanche — c'est-à-dire
 * exactement là où un professionnel itinérant en a besoin.
 *
 * Trois régimes, selon ce que coûte une erreur :
 *
 *  - **navigation** : le réseau d'abord, le cache en secours. Un déploiement
 *    doit arriver au poste dès qu'il y a du réseau ; hors réseau, on sert la
 *    dernière version connue ;
 *  - **interface** (js, css, trames) : le cache d'abord, rafraîchi en fond.
 *    L'ouverture est instantanée, la mise à jour arrive au lancement suivant ;
 *  - **moteurs** (`/vendor/`) : le cache, définitivement. Seize mégaoctets de
 *    PostgreSQL et de modèle de dictée ne se retéléchargent pas ; leur adresse
 *    change avec leur version.
 *
 * Ce qui n'est jamais mis en cache : `/api/`. En mode local il n'y a aucun
 * appel réseau, et en mode serveur une réponse périmée montrerait des données
 * de santé qui ne sont plus à jour.
 */

/**
 * À incrémenter quand le contenu de `PRECACHE` change de forme.
 *
 * Les anciens caches sont effacés à l'activation : c'est ce numéro qui décide
 * qu'un cache est ancien.
 */
const VERSION = "v2";
const CACHE = `educsp-${VERSION}`;

/**
 * Le strict nécessaire pour que l'application s'ouvre hors réseau.
 *
 * Volontairement court : les moteurs WebAssembly sont mis en cache au premier
 * usage, pas à l'installation. Précharger seize mégaoctets pendant que
 * l'utilisateur attend son écran d'accueil serait le punir d'avoir installé.
 */
const PRECACHE = [
  "/",
  "/index.html",
  "/style.css",
  "/manifeste.webmanifest",
  "/icones/icone-192.png",
  "/icones/icone-512.png",
  "/js/app.js",
  "/js/api.js",
  "/js/etat.js",
  "/js/ui.js",
  "/js/portail.js",
  "/js/preparation.js",
  "/js/reglages.js",
  "/js/beneficiaires.js",
  "/js/redaction.js",
  "/js/dictee.js",
  "/js/bilan.js",
  "/js/parcours.js",
  "/js/pilotage.js",
  "/js/pwa.js",
  "/js/local/base.js",
  "/js/local/routeur.js",
  "/js/local/migrations.js",
  "/js/local/schema.js",
  "/js/local/contenuVierge.js",
];

self.addEventListener("install", (evenement) => {
  evenement.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE);
      // `addAll` échoue en bloc si une seule ressource manque : une erreur de
      // chemin rendrait l'application non installable sans rien dire. On ajoute
      // donc une par une, et l'on signale ce qui manque.
      await Promise.all(
        PRECACHE.map(async (chemin) => {
          try {
            await cache.add(new Request(chemin, { cache: "reload" }));
          } catch (err) {
            console.warn("[sw] ressource non mise en cache :", chemin, err.message);
          }
        })
      );
      await self.skipWaiting();
    })()
  );
});

self.addEventListener("activate", (evenement) => {
  evenement.waitUntil(
    (async () => {
      for (const nom of await caches.keys()) {
        if (nom.startsWith("educsp-") && nom !== CACHE) {
          await caches.delete(nom);
        }
      }
      await self.clients.claim();
    })()
  );
});

/** Le cache d'abord ; le réseau seulement si l'on n'a rien. */
async function cacheDabord(requete) {
  const cache = await caches.open(CACHE);
  const connu = await cache.match(requete);
  if (connu) return connu;

  const reponse = await fetch(requete);
  if (reponse.ok) cache.put(requete, reponse.clone());
  return reponse;
}

/** Le cache d'abord, mais on rafraîchit en fond pour le lancement suivant. */
async function cachePuisRafraichir(requete) {
  const cache = await caches.open(CACHE);
  const connu = await cache.match(requete);

  const reseau = fetch(requete)
    .then((reponse) => {
      if (reponse.ok) cache.put(requete, reponse.clone());
      return reponse;
    })
    .catch(() => null);

  return connu ?? (await reseau) ?? Response.error();
}

/** Le réseau d'abord ; le cache si l'on est hors ligne. */
async function reseauDabord(requete) {
  const cache = await caches.open(CACHE);
  try {
    const reponse = await fetch(requete);
    if (reponse.ok) cache.put(requete, reponse.clone());
    return reponse;
  } catch {
    const connu = (await cache.match(requete)) ?? (await cache.match("/index.html"));
    if (connu) return connu;
    throw new Error("hors ligne et rien en cache");
  }
}

self.addEventListener("fetch", (evenement) => {
  const requete = evenement.request;
  if (requete.method !== "GET") return;

  const url = new URL(requete.url);
  if (url.origin !== self.location.origin) return;

  // Jamais de donnée de santé en cache : une réponse périmée vaut moins que
  // pas de réponse du tout.
  if (url.pathname.startsWith("/api/")) return;

  if (requete.mode === "navigate") {
    evenement.respondWith(reseauDabord(requete));
    return;
  }
  if (url.pathname.startsWith("/vendor/") || url.pathname.startsWith("/icones/")) {
    evenement.respondWith(cacheDabord(requete));
    return;
  }
  evenement.respondWith(cachePuisRafraichir(requete));
});
