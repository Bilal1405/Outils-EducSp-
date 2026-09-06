/**
 * Installation de l'application sur l'écran d'accueil.
 *
 * Il n'y a pas de boutique : pas de compte développeur, pas de validation, pas
 * de délai. Android sait installer une application web directement depuis le
 * navigateur — l'icône se pose sur l'écran d'accueil, l'application s'ouvre
 * sans barre d'adresse, et fonctionne sans réseau.
 *
 * L'installation n'est pas un confort ici, elle a deux effets techniques :
 *
 *  - le navigateur accorde d'office le **stockage persistant**. Sans lui, un
 *    téléphone à court d'espace peut effacer les données d'un site pour faire
 *    de la place — c'est-à-dire, ici, des dossiers de bénéficiaires ;
 *  - le service worker garde l'interface hors ligne, ce dont dépend tout
 *    l'intérêt d'une base locale.
 *
 * D'où une invitation visible, mais pas insistante : elle ne paraît qu'en mode
 * local, se referme, et ne revient pas de la séance.
 */
import { $ } from "./ui.js";

/** Retenu tant que l'utilisateur n'a pas tranché : Android n'en donne qu'un. */
let invitation = null;

function afficherBandeau() {
  const bandeau = $("installer");
  if (!bandeau || bandeau.dataset.ecarte === "1") return;
  bandeau.hidden = false;
}

function masquerBandeau(definitivement) {
  const bandeau = $("installer");
  if (!bandeau) return;
  bandeau.hidden = true;
  if (definitivement) bandeau.dataset.ecarte = "1";
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
  if (!local) return;

  void protegerLesDossiers();

  const bandeau = $("installer");
  if (bandeau) {
    $("installer-valider").addEventListener("click", async () => {
      masquerBandeau(true);
      if (!invitation) return;
      invitation.prompt();
      await invitation.userChoice.catch(() => {});
      invitation = null;
    });
    $("installer-plus-tard").addEventListener("click", () => masquerBandeau(true));
  }

  window.addEventListener("beforeinstallprompt", (evenement) => {
    // Sans cela, Chrome affiche sa propre invitation, au moment qui l'arrange.
    evenement.preventDefault();
    invitation = evenement;
    afficherBandeau();
  });

  window.addEventListener("appinstalled", () => {
    masquerBandeau(true);
    invitation = null;
    // L'installation accorde le stockage persistant : c'est le moment de le
    // réclamer, il sera accordé sans question.
    void protegerLesDossiers();
  });
}

/** L'application tourne-t-elle depuis l'écran d'accueil, hors navigateur ? */
export function installee() {
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    window.navigator.standalone === true
  );
}
