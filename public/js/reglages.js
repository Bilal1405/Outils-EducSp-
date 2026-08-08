/**
 * Compte, établissement, équipe.
 *
 * L'identité ne se choisit plus dans une liste déroulante : elle vient de la
 * session. Ce tiroir ne sert donc plus à *décider* qui l'on est, mais à
 * consulter son compte et — pour un coordinateur — à administrer la structure.
 */
import { api } from "./api.js";
import { etat, emettre } from "./etat.js";
import { $, creer, notifier, statut, initiales, vider } from "./ui.js";

/** En dessous de ce reste, le quota passe en alerte visuelle. */
const SEUIL_QUOTA_BAS = 0.2;

const LIBELLES_ROLE = {
  educateur: "Éducateur",
  coordinateur: "Coordinateur",
  admin: "Administrateur",
};

export function estCoordinateur() {
  return etat.utilisateur && etat.utilisateur.role !== "educateur";
}

export function ouvrirReglages(section) {
  const tiroir = $("reglages");
  tiroir.showModal();

  if (!section) return;
  const cible = tiroir.querySelector(`[data-section="${section}"]`);
  if (!cible || cible.hidden) return;
  cible.classList.remove("surlignee");
  // Relance de l'animation : sans ce cycle, un second appel ne rejoue rien.
  void cible.offsetWidth;
  cible.classList.add("surlignee");
  cible.scrollIntoView({ block: "nearest" });
}

// --- Bandeau d'identité ---

export function majBandeau() {
  const utilisateur = etat.utilisateur;
  const etablissement = etat.etablissement;

  $("identite-nom").textContent = utilisateur
    ? `${utilisateur.prenom} ${utilisateur.nom}`
    : "";
  $("identite-etablissement").textContent = etablissement ? etablissement.nom : "";
  $("identite-initiales").textContent = utilisateur
    ? initiales(utilisateur.prenom, utilisateur.nom)
    : "–";

  $("compte-identite").textContent = utilisateur
    ? `${utilisateur.prenom} ${utilisateur.nom} — ${utilisateur.email}`
    : "";
  $("compte-role").textContent = utilisateur
    ? `${LIBELLES_ROLE[utilisateur.role]} · ${etablissement ? etablissement.nom : ""}`
    : "";

  const coordinateur = estCoordinateur();
  for (const section of ["etablissement", "equipe", "journal"]) {
    $("reglages").querySelector(`[data-section="${section}"]`).hidden = !coordinateur;
  }
  $("reglages-pied").textContent = coordinateur
    ? "Vos actions et celles de votre équipe sont journalisées."
    : "Vos actions sont journalisées : consultation, modification et export des bilans.";
}

/**
 * Le quota reste visible en permanence : c'est une limite contractuelle, la
 * découvrir au moment du refus de génération serait tardif.
 */
export function afficherQuota(quota) {
  etat.quota = quota || null;
  const bloc = $("quota");

  if (!quota) {
    bloc.hidden = true;
    $("quota-detail").textContent = "";
    return;
  }

  const total = Number(quota.quota_mensuel) || 0;
  const restant = Math.max(0, Number(quota.restant) || 0);
  const proportion = total > 0 ? restant / total : 0;

  bloc.hidden = false;
  bloc.classList.toggle("quota-epuise", restant === 0);
  bloc.classList.toggle("quota-bas", restant > 0 && proportion <= SEUIL_QUOTA_BAS);
  $("quota-texte").textContent =
    restant === 0
      ? `Quota épuisé (0 / ${total})`
      : `${restant} bilan${restant > 1 ? "s" : ""} sur ${total} ce mois-ci`;
  $("quota-jauge-barre").style.width = `${Math.round(proportion * 100)}%`;

  $("quota-detail").textContent =
    restant === 0
      ? `Quota mensuel atteint : ${quota.bilans_generes} bilan(s) ce mois-ci sur ${total}. Aucun nouveau bilan avant le mois prochain.`
      : `${quota.bilans_generes} bilan(s) ouverts ce mois-ci sur ${total} autorisés.`;
}

export async function rafraichirQuota() {
  try {
    afficherQuota(await api.quota());
  } catch {
    // Un quota indisponible ne doit pas empêcher de travailler : le serveur
    // le revérifie de toute façon avant chaque bilan.
    afficherQuota(null);
  }
}

export async function chargerEtablissement() {
  etat.etablissement = await api.etablissement();

  $("etab-nom").value = etat.etablissement.nom || "";
  $("etab-adresse").value = etat.etablissement.adresse || "";
  $("etab-telephone").value = etat.etablissement.telephone || "";
  $("etab-email").value = etat.etablissement.email || "";
  $("etab-quota").value = etat.etablissement.quota_mensuel_bilans || "";

  majBandeau();
  await rafraichirQuota();
}

// --- Équipe ---

export async function chargerEquipe() {
  if (!estCoordinateur()) return;

  etat.utilisateurs = await api.listerUtilisateurs();
  const liste = $("liste-equipe");
  vider(liste);

  for (const membre of etat.utilisateurs) {
    const soi = membre.id === etat.utilisateur.id;
    liste.append(
      creer("li", { classe: "equipe-ligne" }, [
        creer("span", { classe: "equipe-textes" }, [
          creer("span", {
            classe: "equipe-nom",
            texte: `${membre.prenom} ${membre.nom}${soi ? " (vous)" : ""}`,
          }),
          creer("span", {
            classe: "equipe-meta",
            texte: `${LIBELLES_ROLE[membre.role]} · ${membre.email}`,
          }),
        ]),
        soi
          ? null
          : creer(
              "button",
              {
                classe: "btn btn-secondaire btn-menu btn-danger",
                attrs: { type: "button" },
                sur: { click: () => desactiver(membre) },
              },
              [document.createTextNode("Désactiver")]
            ),
      ])
    );
  }
}

async function desactiver(membre) {
  const sur = window.confirm(
    `Désactiver le compte de ${membre.prenom} ${membre.nom} ?\n\n` +
      "La personne ne pourra plus se connecter et ses sessions en cours seront " +
      "fermées immédiatement. Les bilans qu'elle a rédigés restent intacts, à son nom."
  );
  if (!sur) return;

  try {
    await api.desactiverUtilisateur(membre.id);
    notifier(`Compte de ${membre.prenom} ${membre.nom} désactivé.`, "ok");
    await chargerEquipe();
  } catch (err) {
    notifier(err.message, "erreur");
  }
}

async function creerCompte() {
  const bouton = $("auteur-creer");
  const retour = $("auteur-statut");
  const prenom = $("auteur-prenom").value.trim();
  const nom = $("auteur-nom").value.trim();
  const email = $("auteur-email").value.trim();
  const motDePasse = $("auteur-mot-de-passe").value;

  if (!prenom || !nom || !email || !motDePasse) {
    statut(retour, "Prénom, nom, adresse et mot de passe sont requis.", "erreur");
    return;
  }

  bouton.disabled = true;
  statut(retour, "Création en cours…");
  try {
    await api.creerUtilisateur({
      nom,
      prenom,
      email,
      mot_de_passe: motDePasse,
      role: $("auteur-role").value,
    });
    for (const champ of ["auteur-prenom", "auteur-nom", "auteur-email", "auteur-mot-de-passe"]) {
      $(champ).value = "";
    }
    statut(retour, "");
    $("educateur-ajout").open = false;
    notifier(`${prenom} ${nom} peut désormais se connecter.`, "ok");
    await chargerEquipe();
  } catch (err) {
    statut(retour, err.message, "erreur");
  } finally {
    bouton.disabled = false;
  }
}

// --- Établissement ---

async function enregistrerEtablissement() {
  const bouton = $("etab-enregistrer");
  const retour = $("etab-statut");
  const quotaBrut = $("etab-quota").value.trim();

  const corps = {
    nom: $("etab-nom").value.trim(),
    adresse: $("etab-adresse").value.trim(),
    telephone: $("etab-telephone").value.trim(),
    email: $("etab-email").value.trim(),
  };
  if (!corps.nom) {
    statut(retour, "Le nom de l'établissement est requis.", "erreur");
    return;
  }
  if (quotaBrut) {
    const quota = Number(quotaBrut);
    if (!Number.isInteger(quota) || quota < 1) {
      statut(retour, "Le quota doit être un nombre entier d'au moins 1.", "erreur");
      return;
    }
    corps.quota_mensuel_bilans = quota;
  }

  bouton.disabled = true;
  statut(retour, "Enregistrement…");
  try {
    etat.etablissement = await api.majEtablissement(corps);
    statut(retour, "");
    notifier("Établissement mis à jour.", "ok");
    majBandeau();
    await rafraichirQuota();
  } catch (err) {
    statut(retour, err.message, "erreur");
  } finally {
    bouton.disabled = false;
  }
}

// --- Mot de passe ---

async function changerMotDePasse() {
  const bouton = $("mdp-valider");
  const retour = $("mdp-statut");
  const actuel = $("mdp-actuel").value;
  const nouveau = $("mdp-nouveau").value;

  if (!actuel || !nouveau) {
    statut(retour, "Renseignez les deux champs.", "erreur");
    return;
  }

  bouton.disabled = true;
  statut(retour, "Changement en cours…");
  try {
    await api.changerMotDePasse(actuel, nouveau);
    // Le serveur a fermé toutes les sessions, y compris celle-ci : il n'y a
    // plus rien à afficher, on repart de l'écran de connexion.
    window.location.reload();
  } catch (err) {
    statut(retour, err.message, "erreur");
    bouton.disabled = false;
  }
}

export function initReglages() {
  $("reglages-btn").addEventListener("click", () => ouvrirReglages());
  $("reglages-fermer").addEventListener("click", () => $("reglages").close());

  $("reglages").addEventListener("click", (evenement) => {
    if (evenement.target === $("reglages")) {
      $("reglages").close();
    }
  });

  $("deconnexion-btn").addEventListener("click", async () => {
    try {
      await api.deconnexion();
    } finally {
      window.location.reload();
    }
  });

  $("mdp-valider").addEventListener("click", changerMotDePasse);
  $("etab-enregistrer").addEventListener("click", enregistrerEtablissement);
  $("auteur-creer").addEventListener("click", creerCompte);
  $("journal-btn").addEventListener("click", () => {
    $("reglages").close();
    emettre("ouvrir-journal");
  });

  for (const bouton of document.querySelectorAll("[data-ouvrir-reglages]")) {
    bouton.addEventListener("click", () =>
      ouvrirReglages(bouton.dataset.ouvrirReglages)
    );
  }
}
