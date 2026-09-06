/**
 * Écran d'entrée : connexion, ou mise en service si aucun compte n'existe.
 *
 * Il précède tout le reste. Rien de l'application — ni la liste des
 * bénéficiaires, ni les trames, ni le modèle de dictée — n'est chargé tant que
 * la session n'est pas établie.
 */
import { api, modeLocal } from "./api.js";
import { $, statut } from "./ui.js";

/**
 * Adapte la mise en service à un praticien indépendant.
 *
 * Sur son appareil, il n'y a ni établissement, ni quota — qui compte des
 * bilans pour les facturer —, ni compte à qui se connecter, puisqu'il n'y a
 * pas de serveur.
 *
 * Le mot de passe, surtout, disparaît : il n'est utilisé nulle part en local.
 * En demander un laisserait croire qu'il protège les dossiers, alors que ce
 * sont le verrouillage de l'appareil et son chiffrement qui les protègent.
 * Faire croire à une sécurité qui n'existe pas est pire que de ne rien
 * promettre.
 */
function adapterAuPraticienSeul() {
  $("form-initialisation").querySelector("h1").textContent = "Bienvenue";
  $("form-initialisation").querySelector(".aide").textContent =
    "Vos dossiers resteront sur cet appareil. Indiquez simplement votre nom : " +
    "il figurera comme auteur des bilans.";

  $("init-etablissement-champ").querySelector(".champ-label").textContent =
    "Nom de votre activité (facultatif)";
  $("init-etablissement").removeAttribute("required");

  $("init-quota-champ").hidden = true;

  // Repéré par sa classe : ce bloc n'a pas d'identifiant.
  const deja = $("form-initialisation").querySelector(".portail-deja");
  if (deja) deja.hidden = true;

  // Un champ requis mais masqué empêche l'envoi du formulaire sans rien
  // afficher : le navigateur refuse de mettre le focus dessus, et l'on cherche
  // longtemps pourquoi le bouton ne fait rien.
  const motDePasse = $("init-mot-de-passe");
  motDePasse.removeAttribute("required");
  motDePasse.closest(".champ").hidden = true;

  $("init-valider").textContent = "Commencer";
}

/**
 * Affiche le portail et résout quand une session est ouverte.
 * @returns {Promise<object>} l'utilisateur connecté
 */
export function ouvrirPortail({ initialise, etablissementExistant }) {
  const miseEnServicePossible = initialise === false;

  /**
   * Les deux formulaires sont accessibles tant que la mise en service reste
   * ouverte, et l'on passe de l'un à l'autre.
   *
   * Sans cette bascule, quelqu'un qui a déjà ses identifiants n'avait aucun
   * endroit où les saisir : l'écran de mise en service occupait toute la page.
   * Le cas se produit sur une instance neuve où des comptes existent sans mot
   * de passe, et lorsque deux personnes ouvrent la page en même temps — la
   * seconde reçoit « l'application est déjà initialisée, connectez-vous »,
   * consigne jusqu'ici impossible à suivre.
   *
   * Cela n'ouvre rien : la création du premier compte reste refusée par le
   * serveur dès qu'un compte utilisable existe, quel que soit l'écran affiché.
   */
  function montrer(ecran) {
    const connexion = ecran === "connexion";
    $("form-connexion").hidden = !connexion;
    $("form-initialisation").hidden = connexion;
    $("vers-initialisation").hidden = !miseEnServicePossible;
    $(connexion ? "connexion-email" : premierChampInitialisation()).focus();
  }

  $("portail").hidden = false;
  $("vers-connexion-btn").addEventListener("click", () => montrer("connexion"));
  $("vers-initialisation-btn").addEventListener("click", () =>
    montrer("initialisation")
  );

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

  function premierChampInitialisation() {
    return repris ? "init-prenom" : "init-etablissement";
  }

  if (modeLocal()) {
    adapterAuPraticienSeul();
  }

  montrer(miseEnServicePossible ? "initialisation" : "connexion");

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
        // 409 : quelqu'un a mis l'instance en service entre l'affichage de
        // cette page et l'envoi du formulaire. Le message du serveur dit
        // « connectez-vous » — encore faut-il pouvoir le faire.
        if (err.statut === 409) {
          $("init-mot-de-passe").value = "";
          montrer("connexion");
          statut(
            $("connexion-statut"),
            "L'application vient d'être mise en service. Connectez-vous avec votre compte.",
            "erreur"
          );
        } else {
          statut(retour, err.message, "erreur");
        }
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
