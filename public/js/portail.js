/**
 * Écran d'entrée : connexion, ou mise en service si aucun compte n'existe.
 *
 * Il précède tout le reste. Rien de l'application — ni la liste des
 * bénéficiaires, ni les trames, ni le modèle de dictée — n'est chargé tant que
 * la session n'est pas établie.
 */
import { api } from "./api.js";
import { $, statut } from "./ui.js";

/**
 * Affiche le portail et résout quand une session est ouverte.
 * @returns {Promise<object>} l'utilisateur connecté
 */
export function ouvrirPortail({ initialise, etablissementExistant }) {
  $("portail").hidden = false;
  $("form-connexion").hidden = initialise === false;
  $("form-initialisation").hidden = initialise !== false;

  // Instance mise à jour depuis une version sans authentification :
  // l'établissement et ses bénéficiaires existent déjà, le compte s'y
  // rattache. Redemander son nom laisserait croire qu'on en ouvre un second.
  const repris = Boolean(etablissementExistant);
  $("init-etablissement-champ").hidden = repris;
  $("init-quota-champ").hidden = repris;
  $("init-rappel-etablissement").hidden = !repris;
  if (repris) {
    $("init-rappel-etablissement").textContent =
      `Ce compte sera rattaché à l'établissement existant « ${etablissementExistant.nom} », ` +
      "avec ses bénéficiaires et ses bilans.";
  }

  const premierChamp =
    initialise === false ? (repris ? "init-prenom" : "init-etablissement") : "connexion-email";
  $(premierChamp).focus();

  return new Promise((resoudre) => {
    $("form-connexion").addEventListener("submit", async (evenement) => {
      evenement.preventDefault();
      const bouton = $("connexion-valider");
      const retour = $("connexion-statut");

      bouton.disabled = true;
      statut(retour, "Connexion en cours…");
      try {
        const { utilisateur } = await api.connexion(
          $("connexion-email").value.trim(),
          $("connexion-mot-de-passe").value
        );
        // Le mot de passe ne doit pas survivre dans le DOM après usage.
        $("connexion-mot-de-passe").value = "";
        $("portail").hidden = true;
        resoudre(utilisateur);
      } catch (err) {
        statut(retour, err.message, "erreur");
        $("connexion-mot-de-passe").value = "";
        $("connexion-mot-de-passe").focus();
      } finally {
        bouton.disabled = false;
      }
    });

    $("form-initialisation").addEventListener("submit", async (evenement) => {
      evenement.preventDefault();
      const bouton = $("init-valider");
      const retour = $("init-statut");
      const quota = $("init-quota").value.trim();

      const corps = {
        nom: $("init-nom").value.trim(),
        prenom: $("init-prenom").value.trim(),
        email: $("init-email").value.trim(),
        mot_de_passe: $("init-mot-de-passe").value,
      };
      if (!$("init-etablissement-champ").hidden) {
        corps.etablissement = $("init-etablissement").value.trim();
      }
      if (quota && !$("init-quota-champ").hidden) {
        const valeur = Number(quota);
        if (!Number.isInteger(valeur) || valeur < 1) {
          statut(retour, "Le quota doit être un nombre entier d'au moins 1.", "erreur");
          return;
        }
        corps.quota_mensuel_bilans = valeur;
      }

      bouton.disabled = true;
      statut(retour, "Création en cours…");
      try {
        const { utilisateur } = await api.initialiser(corps);
        $("init-mot-de-passe").value = "";
        $("portail").hidden = true;
        resoudre(utilisateur);
      } catch (err) {
        statut(retour, err.message, "erreur");
      } finally {
        bouton.disabled = false;
      }
    });
  });
}

/**
 * Session perdue en cours d'usage (expiration, déconnexion ailleurs, compte
 * désactivé). On recharge plutôt que de tenter de recoller l'état : la moitié
 * de l'écran afficherait des données que le serveur refuse désormais.
 */
export function sessionPerdue() {
  window.location.reload();
}
