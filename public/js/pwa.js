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
    return await navigator.serviceWorker.register("/sw.js", { scope: "/" });
  } catch (err) {
    // Pas de quoi arrêter l'application : elle fonctionne, elle ne survivra
    // simplement pas à une coupure réseau.
    console.warn("[installation] service worker refusé :", err.message);
    return null;
  }
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
