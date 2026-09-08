/**
 * Installation de l'application sur l'écran d'accueil.
 *
 * Il n'y a pas de boutique : pas de compte développeur, pas de validation, pas
 * de délai. Android sait installer une application web directement depuis le
 * navigateur — l'icône rejoint les autres applications, l'application s'ouvre
 * sans barre d'adresse, et fonctionne sans réseau.
 *
 * L'installation n'est pas un confort ici, elle a deux effets techniques :
 *
 *  - le navigateur accorde d'office le **stockage persistant**. Sans lui, un
 *    téléphone à court d'espace peut effacer les données d'un site pour faire
 *    de la place — c'est-à-dire, ici, des dossiers de bénéficiaires ;
 *  - le service worker garde l'interface hors ligne, ce dont dépend tout
 *    l'intérêt d'une base locale.
 */
import { $ } from "./ui.js";

/**
 * L'invitation d'Android, retenue dès qu'elle arrive.
 *
 * Elle est capturée ici, à l'évaluation du module, et non dans
 * `initInstallation` : Chrome émet `beforeinstallprompt` dans les premières
 * secondes qui suivent le chargement, alors que le démarrage de l'application
 * attend l'ouverture de la base locale — une minute au premier lancement sur
 * un téléphone. L'écoute posée après coup n'entendait rien, et le bandeau
 * d'installation n'apparaissait jamais.
 */
let invitation = null;
let quandElleArrive = null;

/**
 * L'écran affiché en ce moment.
 *
 * Le bandeau peut paraître plusieurs secondes après le démarrage, donc après
 * que l'utilisateur a déjà ouvert un dossier. Réagir aux changements d'écran
 * ne suffisait pas : il faut aussi savoir, au moment de s'afficher, si l'écran
 * courant lui laisse la place.
 */
let vueCourante = "accueil";

window.addEventListener("beforeinstallprompt", (evenement) => {
  // Sans cela, Chrome affiche sa propre invitation, au moment qui l'arrange.
  evenement.preventDefault();
  invitation = evenement;
  if (quandElleArrive) quandElleArrive();
});

/** L'application tourne-t-elle depuis l'écran d'accueil, hors navigateur ? */
export function installee() {
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    window.navigator.standalone === true
  );
}

/**
 * Délai au-delà duquel on considère qu'Android ne proposera rien.
 *
 * Chrome n'émet pas toujours l'invitation : navigateur tiers, application déjà
 * installée, ou critères jugés non réunis. Sans repli, l'utilisateur reste
 * devant une application qu'il ne sait pas installer — et rien ne le lui dit.
 */
const DELAI_INVITATION_MS = 4000;

function afficherBandeau(mode) {
  const bandeau = $("installer");
  if (!bandeau || bandeau.dataset.ecarte === "1" || installee()) return;
  if (vueCourante !== "accueil") return;
  // Les deux bandeaux occupent le même bas d'écran. La mise à jour prime :
  // elle est actionnable tout de suite, l'invitation à installer peut attendre
  // le lancement suivant.
  if (!$("maj").hidden) return;

  $("installer-valider").hidden = mode !== "invitation";
  $("installer-detail").textContent =
    mode === "invitation"
      ? "Ouverture sans réseau, et vos dossiers protégés d'un effacement automatique."
      : "Votre navigateur ne l'a pas proposé. Menu ⋮ en haut à droite, puis " +
        "« Installer l'application » ou « Ajouter à l'écran d'accueil ».";
  bandeau.hidden = false;
}

function masquerBandeau(definitivement) {
  const bandeau = $("installer");
  if (!bandeau) return;
  bandeau.hidden = true;
  if (definitivement) bandeau.dataset.ecarte = "1";
}

/**
 * Le bandeau ne paraît que sur l'écran d'accueil.
 *
 * Il est posé en bas de la fenêtre — là où le parcours guidé place « Étape
 * suivante » et où la fiche d'un bénéficiaire place « Commencer le bilan ».
 * Une invitation qui recouvre le bouton qu'on cherche à atteindre cesse d'être
 * une invitation. L'accueil est le seul écran dont le bas ne porte rien, et
 * c'est de toute façon le moment où l'on décide d'installer.
 */
export function ecarterInstallationPour(vue) {
  vueCourante = vue;
  if (vue !== "accueil") {
    masquerBandeau(false);
  }
}

/**
 * Enregistre le service worker.
 *
 * Sans lui, l'application installée afficherait la page d'erreur du navigateur
 * dès que le réseau manque — alors même que ses données sont sur l'appareil.
 */
async function enregistrerServiceWorker() {
  if (!("serviceWorker" in navigator)) return null;
  try {
    const enregistrement = await navigator.serviceWorker.register("/sw.js", {
      scope: "/",
    });
    surveillerLesMisesAJour(enregistrement);
    return enregistrement;
  } catch (err) {
    // Pas de quoi arrêter l'application : elle fonctionne, elle ne survivra
    // simplement pas à une coupure réseau.
    console.warn("[installation] service worker refusé :", err.message);
    return null;
  }
}

/**
 * Prévient quand une nouvelle version est prête.
 *
 * L'interface est servie depuis le cache pour s'ouvrir sans réseau : une
 * version déployée n'est donc active qu'au lancement **suivant**. Sans
 * avertissement, un praticien travaillerait une séance entière sur l'ancienne
 * sans le savoir — y compris après avoir signalé un défaut et reçu sa
 * correction.
 *
 * On ne recharge pas de force : une actualisation au milieu d'une saisie ferait
 * perdre ce qui n'est pas encore enregistré. C'est à l'utilisateur de choisir
 * son moment.
 */
function surveillerLesMisesAJour(enregistrement) {
  const proposer = () => {
    const bandeau = $("maj");
    if (!bandeau || bandeau.dataset.ecarte === "1") return;
    // Une seule invitation à la fois, au même endroit de l'écran.
    masquerBandeau(false);
    bandeau.hidden = false;
  };

  const suivre = (arrivant) => {
    if (!arrivant) return;
    arrivant.addEventListener("statechange", () => {
      // `controller` absent : c'est la toute première installation, il n'y a
      // rien à remplacer et donc rien à annoncer.
      if (arrivant.state === "installed" && navigator.serviceWorker.controller) {
        proposer();
      }
    });
  };

  if (enregistrement.waiting && navigator.serviceWorker.controller) proposer();
  suivre(enregistrement.installing);
  enregistrement.addEventListener("updatefound", () =>
    suivre(enregistrement.installing)
  );

  const bandeau = $("maj");
  if (bandeau) {
    $("maj-appliquer").addEventListener("click", appliquerLaMiseAJour);
    $("maj-plus-tard").addEventListener("click", () => {
      bandeau.hidden = true;
      bandeau.dataset.ecarte = "1";
    });
  }

  // Le navigateur ne revérifie pas toujours de lui-même. Une demande explicite
  // au lancement suffit : elle ne coûte qu'une requête, et sans elle une
  // correction peut attendre des jours sur un appareil qui ne ferme jamais
  // l'application.
  enregistrement.update().catch(() => {});
}

/**
 * Applique la mise à jour en un seul geste.
 *
 * Recharger tout de suite ne suffisait pas, et c'est le défaut central de
 * l'ancien mécanisme : le rechargement était encore servi par l'ancien service
 * worker, donc par l'ancienne interface. Celui-ci n'installait son remplaçant
 * qu'*après* coup, si bien qu'il fallait fermer et rouvrir une seconde fois.
 * Personne ne devine cela, et rien ne le disait — d'où des corrections
 * signalées comme inopérantes alors qu'elles n'avaient jamais été chargées.
 *
 * On installe donc le remplaçant, on attend qu'il ait pris la main, et l'on
 * recharge seulement ensuite. Un clic, une version.
 */
const ATTENTE_RELEVE_MS = 10000;

export async function appliquerLaMiseAJour() {
  const bouton = $("maj-appliquer");
  if (bouton) {
    bouton.disabled = true;
    bouton.textContent = "Mise à jour…";
  }

  try {
    const enregistrement = await navigator.serviceWorker?.getRegistration();
    if (enregistrement) {
      const releve = new Promise((resoudre) => {
        navigator.serviceWorker.addEventListener("controllerchange", resoudre, {
          once: true,
        });
      });

      await enregistrement.update();

      // Rien de neuf à attendre : le remplaçant est déjà aux commandes, ou il
      // n'y en a pas. Attendre la relève ne ferait que retarder de dix
      // secondes un rechargement qui suffit.
      if (enregistrement.installing || enregistrement.waiting) {
        await Promise.race([
          releve,
          new Promise((r) => setTimeout(r, ATTENTE_RELEVE_MS)),
        ]);
      }
    }
  } catch {
    /* On recharge quand même : au pire, il faudra recommencer. */
  }

  location.reload();
}

/**
 * Repart d'une interface neuve, sans toucher aux dossiers.
 *
 * Recours de dernier ressort quand une version périmée s'accroche. La seule
 * manœuvre connue jusqu'ici était « effacer les données du site » — qui efface
 * aussi la base de données, donc les dossiers des bénéficiaires. Recommander
 * cela comme procédure de mise à jour était une faute : on ne fait pas perdre
 * des données de santé pour rafraîchir un fichier JavaScript.
 *
 * Ne sont supprimés que les caches de l'interface. IndexedDB, où vit la base,
 * n'est pas touché.
 */
export async function repartirDeZero() {
  const supprimes = [];
  if (typeof caches !== "undefined") {
    for (const nom of await caches.keys()) {
      // `transformers-cache` est épargné : le modèle de dictée pèse cent
      // quarante mégaoctets et n'a rien à voir avec la version de l'interface.
      if (nom.startsWith("educsp-")) {
        await caches.delete(nom);
        supprimes.push(nom);
      }
    }
  }
  if ("serviceWorker" in navigator) {
    for (const enr of await navigator.serviceWorker.getRegistrations()) {
      await enr.unregister();
    }
  }
  return supprimes;
}

/**
 * Second mécanisme, indépendant du premier : comparer les versions.
 *
 * Le service worker peut ne rien signaler — navigateur qui ne revérifie pas,
 * enregistrement perdu, mise à jour installée pendant que l'onglet dormait.
 * Cette comparaison-là ne dépend de rien : d'un côté la version embarquée dans
 * le code en train de s'exécuter, de l'autre celle que le serveur publie.
 *
 * Deux mécanismes qui échouent différemment valent mieux qu'un seul auquel on
 * fait confiance.
 */
export async function verifierLaVersion() {
  let courante;
  try {
    ({ VERSION: courante } = await import("./version.js"));
  } catch {
    // Interface servie sans tampon de construction : rien à comparer.
    return null;
  }

  let publiee = null;
  try {
    const reponse = await fetch("/version.json", { cache: "no-store" });
    if (reponse.ok) publiee = (await reponse.json()).id;
  } catch {
    // Hors réseau : c'est normal, et ce n'est pas une anomalie à signaler.
    return { courante: courante.id, publiee: null, aJour: true };
  }

  const aJour = !publiee || publiee === courante.id;
  if (!aJour) {
    const bandeau = $("maj");
    if (bandeau && bandeau.dataset.ecarte !== "1") {
      masquerBandeau(false);
      bandeau.hidden = false;
    }
  }
  return { courante: courante.id, publiee, aJour };
}

/**
 * Demande au navigateur de ne pas effacer la base pour faire de la place.
 *
 * Accordé d'office à une application installée ; demandé quand même dans un
 * onglet ordinaire, où Chrome décide selon l'usage.
 */
async function protegerLesDossiers() {
  try {
    const { protegerStockage } = await import("./local/base.js");
    return await protegerStockage();
  } catch {
    return null;
  }
}

export async function initInstallation({ local }) {
  await enregistrerServiceWorker();
  // Indépendamment du service worker, et même en mode serveur : savoir qu'on
  // travaille sur une version périmée vaut pour tout le monde.
  void verifierLaVersion();
  if (!local || installee()) return;

  void protegerLesDossiers();

  $("installer-valider").addEventListener("click", async () => {
    if (!invitation) return;
    masquerBandeau(true);
    invitation.prompt();
    await invitation.userChoice.catch(() => {});
    invitation = null;
  });
  $("installer-plus-tard").addEventListener("click", () => masquerBandeau(true));

  window.addEventListener("appinstalled", () => {
    masquerBandeau(true);
    invitation = null;
    // L'installation accorde le stockage persistant : c'est le moment de le
    // réclamer, il sera accordé sans question.
    void protegerLesDossiers();
  });

  if (invitation) {
    afficherBandeau("invitation");
    return;
  }

  // Elle peut encore arriver — ou jamais. On attend un peu, puis on explique
  // la marche à suivre plutôt que de laisser l'utilisateur sans rien.
  quandElleArrive = () => afficherBandeau("invitation");
  setTimeout(() => {
    if (!invitation) afficherBandeau("manuel");
  }, DELAI_INVITATION_MS);
}
