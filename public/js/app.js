/**
 * Assemblage de l'interface : vues, onglets, navigation, démarrage.
 *
 * Les modules de vue ne se connaissent pas ; ils publient des événements que ce
 * fichier traduit en changements d'écran.
 */
import { api } from "./api.js";
import { etat, sur } from "./etat.js";
import {
  $,
  age,
  creer,
  formatDate,
  formatDateHeure,
  icone,
  notifier,
  vider,
} from "./ui.js";
import {
  initReglages,
  chargerEtablissement,
  chargerEquipe,
  estCoordinateur,
  majBandeau,
} from "./reglages.js";
import {
  initBeneficiaires,
  chargerBeneficiaires,
  dessinerProfil,
} from "./beneficiaires.js";
import {
  initRedaction,
  restaurerBrouillon,
  arreterDicteeSiActive,
  planifierPreparationDictee,
} from "./redaction.js";
import { initBilan, ouvrirBilan } from "./bilan.js";
import { initParcours, ouvrirParcours } from "./parcours.js";
import { initPilotage, ouvrirJournal, ouvrirTableauDeBord } from "./pilotage.js";
import { ouvrirPortail } from "./portail.js";

// --- Vues et onglets ---

function montrerVue(nom) {
  $("vue-accueil").hidden = nom !== "accueil";
  $("vue-beneficiaire").hidden = nom !== "beneficiaire";
  $("vue-parcours").hidden = nom !== "parcours";
  $("vue-pilotage").hidden = nom !== "pilotage";
  $("vue-bilan").hidden = nom !== "bilan";
  // Le parcours guidé gère sa propre hauteur : chaque étape doit tenir dans
  // l'écran, c'est lui qui décide de ce qui défile.
  $("zone-travail").classList.toggle("zone-travail-pleine", nom === "parcours");
}

function activerOnglet(nom) {
  for (const onglet of document.querySelectorAll(".onglet")) {
    onglet.setAttribute("aria-selected", onglet.dataset.onglet === nom ? "true" : "false");
  }
  $("panneau-redaction").hidden = nom !== "redaction";
  $("panneau-bilans").hidden = nom !== "bilans";
  $("panneau-profil").hidden = nom !== "profil";
}

function initOnglets() {
  const onglets = [...document.querySelectorAll(".onglet")];

  for (const onglet of onglets) {
    onglet.addEventListener("click", () => activerOnglet(onglet.dataset.onglet));

    // Flèches gauche/droite entre onglets : comportement attendu d'un
    // `tablist`, et le seul moyen d'y naviguer sans souris.
    onglet.addEventListener("keydown", (evenement) => {
      const decalage =
        evenement.key === "ArrowRight" ? 1 : evenement.key === "ArrowLeft" ? -1 : 0;
      if (decalage === 0) return;
      evenement.preventDefault();
      const index = (onglets.indexOf(onglet) + decalage + onglets.length) % onglets.length;
      onglets[index].focus();
      activerOnglet(onglets[index].dataset.onglet);
    });
  }
}

// --- Mise en route guidée ---

/**
 * L'établissement et le compte existent dès la connexion : il ne reste qu'un
 * prérequis, le premier bénéficiaire.
 */
function majAccueil() {
  const pret = etat.beneficiaires.length > 0;
  $("accueil-demarrage").hidden = pret;
  $("accueil-pret").hidden = !pret;
}

// --- Liste des bilans d'un bénéficiaire ---

function dessinerBilans() {
  const liste = $("liste-bilans");
  vider(liste);

  const compteur = $("compteur-bilans");
  compteur.hidden = etat.bilans.length === 0;
  compteur.textContent = String(etat.bilans.length);
  $("bilans-vide").hidden = etat.bilans.length > 0;

  const libelleType = (type) =>
    (etat.typesBilan.find((entree) => entree.type === type) || {}).libelle || "Bilan";

  for (const bilan of etat.bilans) {
    const valide = bilan.statut === "validé";
    const origine = bilan.source === "audio" ? "dicté" : "saisi";

    liste.append(
      creer("li", {}, [
        creer(
          "button",
          {
            classe: "bilan-ligne",
            attrs: { type: "button" },
            sur: { click: () => ouvrirDepuisListe(bilan.id) },
          },
          [
            creer("span", { classe: "bilan-ligne-icone" }, [icone("document")]),
            creer("span", { classe: "bilan-ligne-textes" }, [
              creer("span", {
                classe: "bilan-ligne-periode",
                texte: `${libelleType(bilan.type_bilan)} · ${formatDate(bilan.periode_debut)} → ${formatDate(bilan.periode_fin)}`,
              }),
              creer("span", {
                classe: "bilan-ligne-meta",
                texte: `Ouvert le ${formatDateHeure(bilan.date_generation)} · ${origine}`,
              }),
            ]),
            creer("span", {
              classe: "badge " + (valide ? "badge-valide" : "badge-brouillon"),
              texte: valide ? "Validé" : "Brouillon",
            }),
          ]
        ),
      ])
    );
  }
}

async function chargerBilans() {
  if (!etat.beneficiaireId) {
    etat.bilans = [];
    dessinerBilans();
    return;
  }
  try {
    etat.bilans = await api.listerBilans(etat.beneficiaireId);
  } catch (err) {
    etat.bilans = [];
    notifier(err.message, "erreur");
  }
  dessinerBilans();
}

function nomBeneficiaire() {
  const beneficiaire = etat.beneficiaireCourant;
  return beneficiaire ? `${beneficiaire.prenom} ${beneficiaire.nom}` : "Retour";
}

async function ouvrirDepuisListe(id) {
  try {
    ouvrirBilan(await api.bilan(id), nomBeneficiaire());
  } catch (err) {
    notifier(err.message, "erreur");
  }
}

// --- Barre latérale en écran étroit ---

function initBarreLaterale() {
  const barre = $("barre-laterale");
  const voile = $("voile");
  const bouton = $("menu-btn");

  const basculer = (ouvrir) => {
    barre.classList.toggle("ouverte", ouvrir);
    voile.hidden = !ouvrir;
    bouton.setAttribute("aria-expanded", ouvrir ? "true" : "false");
  };

  bouton.addEventListener("click", () => basculer(!barre.classList.contains("ouverte")));
  voile.addEventListener("click", () => basculer(false));
  sur("beneficiaire-change", () => basculer(false));

  document.addEventListener("keydown", (evenement) => {
    if (evenement.key === "Escape" && barre.classList.contains("ouverte")) {
      basculer(false);
    }
  });
}

function initRaccourcis() {
  document.addEventListener("keydown", (evenement) => {
    const cible = evenement.target;
    const dansUnChamp =
      cible instanceof HTMLElement &&
      (cible.tagName === "INPUT" ||
        cible.tagName === "TEXTAREA" ||
        cible.tagName === "SELECT" ||
        cible.isContentEditable);

    if (evenement.key === "/" && !dansUnChamp && !document.querySelector("dialog[open]")) {
      evenement.preventDefault();
      $("recherche").focus();
    }
  });
}

// --- Démarrage ---

function signalerPanne(err) {
  $("app-alerte-texte").textContent =
    `${err.message}. Vérifiez que l'application est démarrée et que la base de données répond, ` +
    `puis rechargez la page.`;
  $("app-alerte").hidden = false;
}

async function demarrer() {
  initReglages();
  initBeneficiaires();
  initRedaction();
  initBilan();
  initParcours();
  initPilotage();
  initOnglets();
  initBarreLaterale();
  initRaccourcis();

  sur("beneficiaires-charges", majAccueil);
  sur("ouvrir-journal", ouvrirJournal);

  sur("beneficiaire-change", async (beneficiaire) => {
    arreterDicteeSiActive();

    if (!beneficiaire) {
      montrerVue("accueil");
      return;
    }

    const annees = age(beneficiaire.date_naissance);
    $("beneficiaire-nom").textContent = `${beneficiaire.prenom} ${beneficiaire.nom}`;
    $("beneficiaire-meta").textContent = [
      annees === null ? "Âge non renseigné" : `${annees} ans`,
      beneficiaire.date_naissance ? `né(e) le ${formatDate(beneficiaire.date_naissance)}` : null,
    ]
      .filter(Boolean)
      .join(" · ");

    dessinerProfil();
    restaurerBrouillon();
    montrerVue("beneficiaire");
    activerOnglet("redaction");
    // L'écran de rédaction est ouvert : le micro peut servir d'un instant à
    // l'autre, autant remettre le modèle en mémoire dès maintenant.
    planifierPreparationDictee();
    await chargerBilans();
  });

  sur("bilan-genere", async (bilan) => {
    await chargerBilans();
    ouvrirBilan(bilan, nomBeneficiaire());
  });

  sur("bilan-enregistre", chargerBilans);

  sur("parcours-ouvert", async (bilan) => {
    await chargerBilans();
    ouvrirParcours(bilan);
  });

  sur("ouvrir-bilan", async ({ bilan, relecture }) => {
    await chargerBilans();
    ouvrirBilan(bilan, nomBeneficiaire(), { relecture });
  });

  sur("retour-beneficiaire", () => {
    montrerVue("beneficiaire");
    activerOnglet("bilans");
  });

  sur("vue", montrerVue);

  try {
    etat.schema = await api.schemaBilan();
    const trames = await api.modeles();
    etat.modeles = trames.modeles;
    etat.typesBilan = trames.types;
    await chargerEtablissement();
    await chargerEquipe();
    await chargerBeneficiaires();
  } catch (err) {
    signalerPanne(err);
    return;
  }

  $("suivi-btn").hidden = !estCoordinateur();
  $("suivi-btn").addEventListener("click", ouvrirTableauDeBord);
  majAccueil();
  montrerVue("accueil");
}

/**
 * Séquence de démarrage : la session d'abord, l'application ensuite. Rien de
 * l'outil — ni la liste des bénéficiaires, ni les trames — n'est demandé au
 * serveur avant d'être authentifié.
 */
async function amorcer() {
  let etatAuth;
  try {
    etatAuth = await api.etatAuth();
  } catch (err) {
    signalerPanne(err);
    return;
  }

  etat.utilisateur =
    etatAuth.utilisateur ||
    (await ouvrirPortail({
      initialise: etatAuth.initialise,
      etablissementExistant: etatAuth.etablissement_existant,
    }));

  // L'application n'est révélée qu'une fois la session établie. La masquer
  // seulement à l'écran ne suffirait pas : elle resterait dans l'ordre de
  // tabulation et dans l'arbre d'accessibilité, sous l'écran de connexion.
  $("entete").hidden = false;
  $("app").hidden = false;
  majBandeau();
  await demarrer();
}

amorcer();
