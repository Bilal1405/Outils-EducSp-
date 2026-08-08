/**
 * Vues du coordinateur : suivi des bilans et journal d'accès.
 *
 * Deux besoins qu'aucun écran ne couvrait : savoir où en est l'équipe, et
 * pouvoir répondre à « qui a consulté ce dossier, et quand ». Le second n'est
 * pas un confort — c'est ce qu'on demande à une structure médico-sociale lors
 * d'un contrôle ou d'un signalement.
 */
import { api } from "./api.js";
import { etat, emettre } from "./etat.js";
import { $, creer, formatDate, notifier, vider } from "./ui.js";

/** Au-delà, un bilan trimestriel est considéré comme dû. */
const MOIS_AVANT_ECHEANCE = 3;

const LIBELLES_ACTION = {
  connexion: "Connexion",
  connexion_refusee: "Connexion refusée",
  deconnexion: "Déconnexion",
  initialisation: "Mise en service",
  beneficiaire_cree: "Bénéficiaire créé",
  beneficiaire_modifie: "Fiche modifiée",
  beneficiaire_supprime: "Bénéficiaire supprimé",
  beneficiaire_consulte: "Fiche consultée",
  bilan_ouvert: "Bilan ouvert",
  bilan_genere: "Bilan généré",
  bilan_consulte: "Bilan consulté",
  bilan_modifie: "Bilan modifié",
  bilan_valide: "Bilan validé",
  bilan_exporte: "Bilan exporté",
  utilisateur_cree: "Compte créé",
  utilisateur_desactive: "Compte désactivé",
  mot_de_passe_change: "Mot de passe changé",
  reformulation: "Reformulation",
};

function moisEcoules(depuis) {
  if (!depuis) return null;
  const date = new Date(depuis);
  if (Number.isNaN(date.getTime())) return null;
  const maintenant = new Date();
  return (
    (maintenant.getFullYear() - date.getFullYear()) * 12 +
    (maintenant.getMonth() - date.getMonth())
  );
}

function celluleEcheance(dernier) {
  if (!dernier) {
    // Une absence de bilan n'est pas un retard : le bénéficiaire vient
    // peut-être d'arriver. On le dit sans le colorer en alerte.
    return creer("span", { classe: "valeur-vide", texte: "Aucun" });
  }
  const ecart = moisEcoules(dernier);
  const enRetard = ecart !== null && ecart >= MOIS_AVANT_ECHEANCE;
  return creer("span", {
    classe: enRetard ? "echeance-depassee" : "",
    texte: formatDate(dernier) + (enRetard ? ` · ${ecart} mois` : ""),
  });
}

async function dessinerTableauDeBord() {
  const corps = $("pilotage-corps");
  vider(corps);
  $("pilotage-titre").textContent = "Suivi des bilans";

  const lignes = await api.tableauDeBord();
  $("pilotage-meta").textContent =
    `${lignes.length} bénéficiaire${lignes.length > 1 ? "s" : ""} · ` +
    `un trimestriel est signalé au-delà de ${MOIS_AVANT_ECHEANCE} mois`;

  if (lignes.length === 0) {
    corps.append(
      creer("p", { classe: "etat-vide", texte: "Aucun bénéficiaire enregistré." })
    );
    return;
  }

  corps.append(
    creer("div", { classe: "cotation-cadre" }, [
      creer("table", { classe: "grille-tableau tableau-suivi" }, [
        creer("thead", {}, [
          creer("tr", {}, [
            creer("th", { texte: "Bénéficiaire" }),
            creer("th", { texte: "Dernier trimestriel" }),
            creer("th", { texte: "Dernier répit" }),
            creer("th", { texte: "Dernier bilan" }),
            creer("th", { texte: "Brouillons" }),
          ]),
        ]),
        creer(
          "tbody",
          {},
          lignes.map((ligne) =>
            creer("tr", {}, [
              creer("th", {
                attrs: { scope: "row" },
                texte: `${ligne.prenom} ${ligne.nom}`,
              }),
              creer("td", {}, [celluleEcheance(ligne.dernier_trimestriel)]),
              creer("td", {}, [celluleEcheance(ligne.dernier_repit)]),
              creer("td", {}, [celluleEcheance(ligne.dernier_bilan)]),
              creer("td", {
                texte: ligne.brouillons > 0 ? String(ligne.brouillons) : "—",
              }),
            ])
          )
        ),
      ]),
    ])
  );
}

async function dessinerJournal() {
  const corps = $("pilotage-corps");
  vider(corps);
  $("pilotage-titre").textContent = "Journal d'accès";

  const lignes = await api.audit(300);
  $("pilotage-meta").textContent =
    `${lignes.length} dernière${lignes.length > 1 ? "s" : ""} entrée${lignes.length > 1 ? "s" : ""}` +
    " · consultations, modifications et exports";

  if (lignes.length === 0) {
    corps.append(
      creer("p", { classe: "etat-vide", texte: "Aucune entrée pour l'instant." })
    );
    return;
  }

  corps.append(
    creer("div", { classe: "cotation-cadre" }, [
      creer("table", { classe: "grille-tableau tableau-journal" }, [
        creer("thead", {}, [
          creer("tr", {}, [
            creer("th", { texte: "Quand" }),
            creer("th", { texte: "Qui" }),
            creer("th", { texte: "Quoi" }),
            creer("th", { texte: "Sur" }),
          ]),
        ]),
        creer(
          "tbody",
          {},
          lignes.map((ligne) =>
            creer("tr", {}, [
              creer("td", {
                texte: new Date(ligne.horodatage).toLocaleString("fr-FR", {
                  dateStyle: "short",
                  timeStyle: "short",
                }),
              }),
              creer("td", { texte: ligne.utilisateur_libelle || "—" }),
              creer("td", { texte: LIBELLES_ACTION[ligne.action] || ligne.action }),
              creer("td", { texte: ligne.cible_libelle || ligne.cible_type || "—" }),
            ])
          )
        ),
      ]),
    ])
  );
}

async function ouvrir(dessiner) {
  emettre("vue", "pilotage");
  $("pilotage-corps").textContent = "Chargement…";
  try {
    await dessiner();
  } catch (err) {
    notifier(err.message, "erreur");
    vider($("pilotage-corps"));
    $("pilotage-corps").append(
      creer("p", { classe: "etat-vide", texte: err.message })
    );
  }
}

export function initPilotage() {
  $("pilotage-fermer").addEventListener("click", () => {
    emettre("vue", etat.beneficiaireId ? "beneficiaire" : "accueil");
  });
}

export function ouvrirTableauDeBord() {
  return ouvrir(dessinerTableauDeBord);
}

export function ouvrirJournal() {
  return ouvrir(dessinerJournal);
}
