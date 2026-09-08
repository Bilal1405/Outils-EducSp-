/**
 * Donner à lire ce qui sort de l'appareil, au lieu de l'affirmer.
 *
 * Le masquage (`local/masquage.js`) retire les noms que la base connaît. Il ne
 * peut rien contre un prénom qu'elle ignore — une fratrie, un collègue, une
 * école — et prétendre l'inverse serait pire que de ne rien promettre. Cet
 * écran montre le texte exact qui partira, une fois avant le premier envoi sur
 * l'appareil, puis à la demande depuis les réglages.
 *
 * Il ne se contente pas d'informer : il **retient l'envoi** tant qu'il est
 * ouvert. C'est la seule occasion de refuser en connaissance de cause.
 */
import { $ } from "./ui.js";

/** Vu une fois, on ne réinterrompt plus le travail à chaque bilan. */
const CLE_VU = "educsp-apercu-vu";

function dejaVu() {
  try {
    return localStorage.getItem(CLE_VU) === "1";
  } catch {
    return false;
  }
}

function marquerVu() {
  try {
    localStorage.setItem(CLE_VU, "1");
  } catch {
    /* Le stockage est refusé : l'aperçu reparaîtra, ce qui n'est pas grave. */
  }
}

function remplir(texte, jetons) {
  $("apercu-texte").textContent = texte;
  $("apercu-jetons").textContent = jetons.length
    ? `Remplacés avant l'envoi : ${jetons.join(", ")}.`
    : "Aucun nom connu de vos dossiers n'a été trouvé dans ce texte.";
}

/**
 * Montre l'aperçu et attend la décision.
 *
 * @returns {Promise<boolean>} `true` si l'envoi doit se poursuivre.
 */
export function demanderConfirmation(texte, jetons) {
  const dialogue = $("dlg-apercu");
  const poursuivre = $("apercu-poursuivre");
  remplir(texte, jetons);
  poursuivre.hidden = false;

  return new Promise((resoudre) => {
    let decision = false;
    const surFermeture = () => {
      poursuivre.hidden = true;
      poursuivre.removeEventListener("click", surEnvoi);
      dialogue.removeEventListener("close", surFermeture);
      resoudre(decision);
    };
    const surEnvoi = () => {
      decision = true;
      marquerVu();
      dialogue.close();
    };
    poursuivre.addEventListener("click", surEnvoi);
    dialogue.addEventListener("close", surFermeture);
    dialogue.showModal();
  });
}

/** Montre l'aperçu sans rien attendre — depuis les réglages. */
export function montrer(texte, jetons) {
  $("apercu-poursuivre").hidden = true;
  remplir(texte, jetons);
  $("dlg-apercu").showModal();
}

/**
 * Le point d'entrée du routeur local : masque, montre si c'est la première
 * fois, et rend le texte à envoyer — ou `null` si l'éducateur a refusé.
 */
export async function validerEnvoi(texteMasque, jetons) {
  if (dejaVu()) return true;
  return demanderConfirmation(texteMasque, jetons);
}
