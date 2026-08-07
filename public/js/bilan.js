/**
 * Relecture et correction d'un bilan.
 *
 * L'écran remplaçait auparavant cette étape par un JSON brut dans une zone de
 * texte. C'était inutilisable : la relecture est le seul moment où un humain
 * reprend la main sur une sortie de modèle, elle doit se faire section par
 * section, en français, sans risque de casser la structure.
 *
 * Les valeurs contraintes (domaines, comportements, fréquences) sont proposées
 * en listes déroulantes alimentées par `/api/schema/bilan` : l'éducateur ne
 * peut pas produire un contenu que la validation serveur rejettera.
 */
import { api } from "./api.js";
import { etat, emettre } from "./etat.js";
import { ouvrirParcours, rendreModeleLectureSeule } from "./parcours.js";
import {
  $,
  creer,
  formatDate,
  formatDateHeure,
  icone,
  notifier,
  statut,
  vider,
} from "./ui.js";

/**
 * Description des sections répétables du bilan. Une seule table décrit à la
 * fois le rendu modifiable et le rendu en lecture seule : les deux ne peuvent
 * pas diverger.
 */
const SECTIONS = [
  {
    cle: "objectifs_intervention_periode",
    titre: "Objectifs de la période",
    vide: "Aucun objectif enregistré pour cette période.",
    ajout: "Ajouter un objectif",
    modele: (schema) => ({
      domaine_competence: schema.domaines_competence[0],
      objectif: "",
    }),
    champs: [
      { cle: "domaine_competence", label: "Domaine", liste: "domaines_competence" },
      { cle: "objectif", label: "Objectif", multiligne: true },
    ],
  },
  {
    cle: "evaluation_comportement",
    titre: "Comportements observés",
    vide: "Aucun comportement évalué.",
    ajout: "Ajouter un comportement",
    disposition: "duo",
    modele: (schema) => ({
      type_comportement: schema.types_comportement[0],
      frequence: schema.frequences_comportement[0],
    }),
    champs: [
      { cle: "type_comportement", label: "Type", liste: "types_comportement" },
      { cle: "frequence", label: "Fréquence", liste: "frequences_comportement" },
    ],
  },
  {
    cle: "evaluation_objectifs_par_domaine",
    titre: "Évaluation par domaine",
    vide: "Aucune évaluation par domaine.",
    ajout: "Ajouter une évaluation",
    modele: (schema) => ({
      domaine_competence: schema.domaines_competence[0],
      observations: "",
    }),
    champs: [
      { cle: "domaine_competence", label: "Domaine", liste: "domaines_competence" },
      { cle: "observations", label: "Observations", multiligne: true },
    ],
  },
  {
    cle: "autres_observations",
    titre: "Autres observations",
    vide: "Aucune autre observation.",
    ajout: "Ajouter une observation",
    chaines: true,
    modele: () => "",
    champs: [{ cle: null, label: "Observation", multiligne: true }],
  },
  {
    cle: "proposition_objectifs_periode_suivante",
    titre: "Objectifs proposés pour la période suivante",
    vide: "Aucun objectif proposé pour la période suivante.",
    ajout: "Ajouter une proposition",
    modele: (schema) => ({
      domaine_competence: schema.domaines_competence[0],
      objectif: "",
      comment: "",
    }),
    champs: [
      { cle: "domaine_competence", label: "Domaine", liste: "domaines_competence" },
      { cle: "objectif", label: "Objectif", multiligne: true },
      { cle: "comment", label: "Modalités de mise en œuvre", multiligne: true },
    ],
  },
];

/** Champs de l'en-tête, dans l'ordre d'affichage. */
const CHAMPS_ENTETE = [
  { cle: "structure", label: "Structure" },
  { cle: "beneficiaire_nom", label: "Bénéficiaire" },
  { cle: "beneficiaire_age", label: "Âge", nombre: true },
  { cle: "beneficiaire_date_naissance", label: "Date de naissance" },
  { cle: "beneficiaire_lieu_naissance", label: "Lieu de naissance" },
  { cle: "periode_debut", label: "Début de période" },
  { cle: "periode_fin", label: "Fin de période" },
  { cle: "date_debut_intervention", label: "Début de l'intervention" },
  { cle: "jours_heures_intervention", label: "Jours et horaires", large: true },
  { cle: "lieux", label: "Lieux", large: true },
  { cle: "personnes_presentes", label: "Personnes présentes", large: true },
];

let retourLibelle = "Retour";

function modifiable() {
  return etat.bilanCourant && etat.bilanCourant.statut !== "validé";
}

function marquerModifie() {
  etat.modifie = true;
  majIndicateur();
}

function majIndicateur() {
  statut(
    $("bilan-statut"),
    etat.modifie ? "Modifications non enregistrées." : "",
    etat.modifie ? "erreur" : ""
  );
  $("bilan-enregistrer").disabled = !etat.modifie;
}

// --- Fabriques de champs ---

function champTexte({ label, valeur, multiligne, large, onChange }) {
  const contenu = valeur === null || valeur === undefined ? "" : String(valeur);

  if (!modifiable()) {
    return creer(
      "div",
      { classe: "champ" + (large ? " champ-large" : "") },
      [
        creer("span", { classe: "champ-label", texte: label }),
        contenu.trim()
          ? creer("div", { classe: "valeur", texte: contenu })
          : creer("div", { classe: "valeur valeur-vide", texte: "Non renseigné" }),
      ]
    );
  }

  const saisie = creer(multiligne ? "textarea" : "input", {
    attrs: multiligne ? { rows: 3 } : { type: "text" },
    sur: {
      input: (evenement) => {
        onChange(evenement.target.value);
        marquerModifie();
      },
    },
  });
  saisie.value = contenu;

  return creer("label", { classe: "champ" + (large ? " champ-large" : "") }, [
    creer("span", { classe: "champ-label", texte: label }),
    saisie,
  ]);
}

function champNombre({ label, valeur, onChange }) {
  if (!modifiable()) {
    return champTexte({ label, valeur, onChange });
  }
  const saisie = creer("input", {
    attrs: { type: "number", min: "0", step: "1" },
    sur: {
      input: (evenement) => {
        const brut = evenement.target.value;
        onChange(brut === "" ? Number.NaN : Number(brut));
        marquerModifie();
      },
    },
  });
  saisie.value = Number.isFinite(valeur) ? String(valeur) : "";
  return creer("label", { classe: "champ" }, [
    creer("span", { classe: "champ-label", texte: label }),
    saisie,
  ]);
}

function champListeFermee({ label, valeur, options, onChange }) {
  if (!modifiable()) {
    return champTexte({ label, valeur, onChange });
  }

  const select = creer("select", {
    sur: {
      change: (evenement) => {
        onChange(evenement.target.value);
        marquerModifie();
      },
    },
  });
  for (const option of options) {
    select.append(creer("option", { texte: option, attrs: { value: option } }));
  }
  // Une valeur hors liste ne doit pas disparaître en silence : elle est
  // ajoutée et signalée, faute de quoi une correction se ferait à l'insu de
  // l'éducateur.
  if (valeur && !options.includes(valeur)) {
    select.prepend(
      creer("option", { texte: `${valeur} (valeur inattendue)`, attrs: { value: valeur } })
    );
  }
  select.value = valeur ?? "";

  return creer("label", { classe: "champ" }, [
    creer("span", { classe: "champ-label", texte: label }),
    select,
  ]);
}

function boutonSupprimer(onClic) {
  return creer(
    "button",
    {
      classe: "btn-icone element-supprimer",
      attrs: { type: "button", "aria-label": "Supprimer cet élément" },
      sur: { click: onClic },
    },
    [icone("corbeille")]
  );
}

// --- Rendu des sections ---

function rendreEnTete(enTete) {
  const grille = creer("div", { classe: "grille-entete" });

  for (const champ of CHAMPS_ENTETE) {
    const commun = {
      label: champ.label,
      valeur: enTete[champ.cle],
      large: champ.large,
      onChange: (valeur) => {
        enTete[champ.cle] = valeur;
      },
    };
    grille.append(champ.nombre ? champNombre(commun) : champTexte(commun));
  }

  grille.append(rendreIntervenants(enTete));

  return creer("section", { classe: "section-bilan" }, [
    creer("h2", { texte: "En-tête" }),
    grille,
  ]);
}

function rendreIntervenants(enTete) {
  const bloc = creer("div", { classe: "champ champ-large" }, [
    creer("span", { classe: "champ-label", texte: "Professionnels intervenants" }),
  ]);

  const liste = enTete.professionnels_intervenants || [];

  if (!modifiable()) {
    bloc.append(
      liste.length
        ? creer("div", { classe: "valeur", texte: liste.join(", ") })
        : creer("div", { classe: "valeur valeur-vide", texte: "Non renseigné" })
    );
    return bloc;
  }

  const elements = creer("div", { classe: "elements" });
  const redessiner = () => {
    vider(elements);
    if (liste.length === 0) {
      elements.append(
        creer("p", { classe: "section-vide", texte: "Aucun intervenant renseigné." })
      );
    }
    liste.forEach((nom, index) => {
      const saisie = creer("input", {
        attrs: { type: "text", "aria-label": `Intervenant ${index + 1}` },
        sur: {
          input: (evenement) => {
            liste[index] = evenement.target.value;
            marquerModifie();
          },
        },
      });
      saisie.value = nom;
      elements.append(
        creer("div", { classe: "element" }, [
          creer("div", { classe: "element-corps" }, [saisie]),
          boutonSupprimer(() => {
            liste.splice(index, 1);
            marquerModifie();
            redessiner();
          }),
        ])
      );
    });
  };
  redessiner();

  bloc.append(
    elements,
    creer(
      "button",
      {
        classe: "btn btn-secondaire ajouter-element",
        attrs: { type: "button" },
        sur: {
          click: () => {
            liste.push("");
            marquerModifie();
            redessiner();
          },
        },
      },
      [icone("plus"), document.createTextNode("Ajouter un intervenant")]
    )
  );

  return bloc;
}

function rendreElementLecture(section, element) {
  const bloc = creer("dl", { classe: "element-lecture" });

  for (const champ of section.champs) {
    const valeur = champ.cle === null ? element : element[champ.cle];
    const texte = valeur === null || valeur === undefined ? "" : String(valeur);
    const estCategorie = Boolean(champ.liste);

    if (estCategorie && bloc.children.length === 0) {
      bloc.append(creer("dt", { texte: texte || "Sans domaine" }));
      continue;
    }
    bloc.append(
      creer(
        "dd",
        texte.trim()
          ? { texte: estCategorie ? `${champ.label} : ${texte}` : texte }
          : { classe: "valeur-vide", texte: `${champ.label} : non renseigné` }
      )
    );
  }

  return bloc;
}

function rendreSection(section, contenu, schema) {
  const corps = creer("div", { classe: "elements" });
  const liste = Array.isArray(contenu[section.cle]) ? contenu[section.cle] : [];

  const redessiner = () => {
    vider(corps);

    if (liste.length === 0) {
      // L'absence reste visible : une section vide n'est pas une section
      // masquée.
      corps.append(creer("p", { classe: "section-vide", texte: section.vide }));
      return;
    }

    liste.forEach((element, index) => {
      if (!modifiable()) {
        corps.append(rendreElementLecture(section, element));
        return;
      }

      const champs = section.champs.map((champ) => {
        const valeur = champ.cle === null ? element : element[champ.cle];
        const appliquer = (nouvelle) => {
          if (champ.cle === null) {
            liste[index] = nouvelle;
          } else {
            liste[index][champ.cle] = nouvelle;
          }
        };

        if (champ.liste) {
          return champListeFermee({
            label: champ.label,
            valeur,
            options: schema[champ.liste],
            onChange: appliquer,
          });
        }
        return champTexte({
          label: champ.label,
          valeur,
          multiligne: champ.multiligne,
          onChange: appliquer,
        });
      });

      const interieur =
        section.disposition === "duo"
          ? [creer("div", { classe: "element-duo" }, champs)]
          : champs;

      corps.append(
        creer("div", { classe: "element" }, [
          creer("div", { classe: "element-corps" }, interieur),
          boutonSupprimer(() => {
            liste.splice(index, 1);
            marquerModifie();
            redessiner();
          }),
        ])
      );
    });
  };
  redessiner();

  return creer("section", { classe: "section-bilan" }, [
    creer("h2", { texte: section.titre }),
    corps,
    modifiable()
      ? creer(
          "button",
          {
            classe: "btn btn-secondaire ajouter-element",
            attrs: { type: "button" },
            sur: {
              click: () => {
                liste.push(section.modele(schema));
                contenu[section.cle] = liste;
                marquerModifie();
                redessiner();
              },
            },
          },
          [icone("plus"), document.createTextNode(section.ajout)]
        )
      : null,
  ]);
}

function rendreDonneesComplementaires(contenu) {
  return creer("section", { classe: "section-bilan" }, [
    creer("h2", { texte: "Données complémentaires" }),
    champTexte({
      label: "Éléments de contexte",
      valeur: contenu.donnees_complementaires,
      multiligne: true,
      large: true,
      onChange: (valeur) => {
        contenu.donnees_complementaires = valeur;
      },
    }),
  ]);
}

function dessinerCorps() {
  const contenu = etat.contenuEdite;
  const schema = etat.schema;
  const corps = $("bilan-corps");
  vider(corps);

  corps.append(rendreEnTete(contenu.en_tete));
  corps.append(rendreSection(SECTIONS[0], contenu, schema));
  corps.append(rendreSection(SECTIONS[1], contenu, schema));
  corps.append(rendreSection(SECTIONS[2], contenu, schema));
  corps.append(rendreDonneesComplementaires(contenu));
  corps.append(rendreSection(SECTIONS[3], contenu, schema));
  corps.append(rendreSection(SECTIONS[4], contenu, schema));

  $("bilan-json").textContent = JSON.stringify(contenu, null, 2);
}

// --- Ouverture ---

export function ouvrirBilan(bilan, libelleRetour, options = {}) {
  const trame = bilan.type_bilan || "bilan";
  const guideEnBrouillon = trame !== "bilan" && bilan.statut !== "validé";

  // Un bilan à trame fixe encore en brouillon se reprend là où il en était :
  // le formulaire guidé est son écran d'édition, pas celui-ci. Sauf demande
  // explicite — à la fin du parcours, on vient justement s'y relire.
  if (guideEnBrouillon && !options.relecture) {
    ouvrirParcours(bilan);
    return;
  }

  etat.bilanCourant = bilan;
  etat.contenuEdite = structuredClone(bilan.contenu);
  etat.modifie = false;
  retourLibelle = libelleRetour || "Retour";

  const modele = trame === "bilan" ? null : etat.modeles && etat.modeles[trame];

  $("bilan-retour-libelle").textContent = retourLibelle;
  $("bilan-titre").textContent = modele
    ? `${modele.nom} · ${formatDate(bilan.periode_debut)} → ${formatDate(bilan.periode_fin)}`
    : `Bilan ${formatDate(bilan.periode_debut)} → ${formatDate(bilan.periode_fin)}`;

  const origine = bilan.source === "audio" ? "dicté" : "saisi au clavier";
  $("bilan-meta").textContent = bilan.date_generation
    ? `Généré le ${formatDateHeure(bilan.date_generation)} · compte-rendu ${origine}`
    : `Compte-rendu ${origine}`;

  const valide = bilan.statut === "validé";
  const badge = $("bilan-badge");
  badge.textContent = valide ? "Validé" : "Brouillon";
  badge.className = "badge " + (valide ? "badge-valide" : "badge-brouillon");

  $("bilan-consigne").hidden = valide;
  $("bilan-consigne-valide").hidden = !valide;
  // Un bilan à trame fixe ne s'édite pas ici : on y retourne par le parcours,
  // qui est son écran de saisie.
  $("bilan-enregistrer").hidden = valide || Boolean(modele);
  $("bilan-reprendre").hidden = !guideEnBrouillon;
  $("bilan-valider").hidden = valide;
  $("bilan-export").href = api.lienExport(bilan.id);

  if (modele) {
    rendreModeleLectureSeule(modele, etat.contenuEdite, $("bilan-corps"));
    $("bilan-json").textContent = JSON.stringify(etat.contenuEdite, null, 2);
  } else {
    dessinerCorps();
  }
  majIndicateur();
  emettre("vue", "bilan");
  $("zone-travail").scrollTo({ top: 0 });
}

// --- Enregistrement ---

/**
 * Contrôles locaux avant envoi. Le serveur revalide de toute façon ; l'intérêt
 * est de rendre l'erreur compréhensible et située.
 */
function verifierContenu(contenu) {
  // Contrôle propre à la trame « bilan » : elle seule porte un `en_tete` avec
  // un âge numérique. Les trames fixes n'ont pas de champ à ce format, et le
  // serveur les valide de toute façon contre leur propre schéma.
  const trame = etat.bilanCourant ? etat.bilanCourant.type_bilan || "bilan" : "bilan";
  if (trame !== "bilan") {
    return null;
  }
  if (!Number.isFinite(contenu.en_tete.beneficiaire_age)) {
    return "L'âge du bénéficiaire doit être un nombre.";
  }
  return null;
}

async function enregistrer({ valider }) {
  if (!etat.bilanCourant) return false;

  const probleme = verifierContenu(etat.contenuEdite);
  if (probleme) {
    statut($("bilan-statut"), probleme, "erreur");
    return false;
  }

  const boutons = [$("bilan-enregistrer"), $("bilan-valider")];
  boutons.forEach((bouton) => (bouton.disabled = true));
  statut($("bilan-statut"), valider ? "Validation en cours…" : "Enregistrement…");

  try {
    const corps = { contenu: etat.contenuEdite };
    if (valider) {
      corps.statut = "validé";
    }
    const misAJour = await api.modifierBilan(etat.bilanCourant.id, corps);

    etat.modifie = false;
    notifier(
      valider ? "Bilan validé et archivé." : "Modifications enregistrées.",
      "ok"
    );
    ouvrirBilan({ ...etat.bilanCourant, ...misAJour }, retourLibelle);
    emettre("bilan-enregistre");
    return true;
  } catch (err) {
    statut($("bilan-statut"), err.message, "erreur");
    notifier(err.message, "erreur");
    return false;
  } finally {
    boutons.forEach((bouton) => (bouton.disabled = false));
    majIndicateur();
  }
}

/**
 * Garde-fou avant de quitter l'écran. Enregistrer d'office serait pire :
 * l'éducateur perdrait la possibilité d'abandonner une correction.
 */
export function confirmerAbandon() {
  if (!etat.modifie) return true;
  return window.confirm(
    "Des modifications de ce bilan ne sont pas enregistrées. Quitter sans les enregistrer ?"
  );
}

export function initBilan() {
  $("bilan-retour").addEventListener("click", () => {
    if (!confirmerAbandon()) return;
    etat.modifie = false;
    emettre("retour-beneficiaire");
  });

  $("bilan-enregistrer").addEventListener("click", () => enregistrer({ valider: false }));

  $("bilan-reprendre").addEventListener("click", () => {
    ouvrirParcours(etat.bilanCourant);
  });

  $("bilan-valider").addEventListener("click", () => {
    $("dlg-validation").showModal();
  });

  $("validation-confirmer").addEventListener("click", async () => {
    $("dlg-validation").close();
    await enregistrer({ valider: true });
  });

  // Exporter reflète ce qui est enregistré côté serveur : on enregistre
  // d'abord, sinon le fichier produit ne correspondrait pas à l'écran.
  $("bilan-export").addEventListener("click", async (evenement) => {
    if (!etat.modifie) return;
    evenement.preventDefault();
    if (await enregistrer({ valider: false })) {
      window.location.assign(api.lienExport(etat.bilanCourant.id));
    }
  });

  document.addEventListener("keydown", (evenement) => {
    const dansBilan = !$("vue-bilan").hidden;
    if (dansBilan && (evenement.ctrlKey || evenement.metaKey) && evenement.key === "s") {
      evenement.preventDefault();
      if (etat.modifie) {
        enregistrer({ valider: false });
      }
    }
  });
}
