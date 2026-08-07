/**
 * Parcours guidé des bilans à trame fixe (Répit, Trimestriel).
 *
 * Ces deux documents ne sont pas rédigés par le moteur : ce sont des grilles
 * d'évaluation que l'éducateur remplit lui-même. Les faire déduire par une IA
 * reviendrait à lui faire coter des compétences qu'elle n'a pas observées.
 *
 * L'écran est donc un formulaire, découpé en étapes tenant chacune dans une
 * hauteur d'écran : on coche, on dicte les commentaires, on passe à la suite.
 * Le moteur n'intervient qu'à un seul endroit, sur demande — remettre au propre
 * un commentaire dicté, sans rien y ajouter.
 *
 * La trame vient du serveur (`/api/schema/modeles`) : c'est la même
 * description qui valide le contenu enregistré et produit l'export Word.
 */
import { api } from "./api.js";
import { etat, emettre } from "./etat.js";
import * as dictee from "./dictee.js";
import { $, creer, icone, notifier, statut, vider } from "./ui.js";

/** Texte d'origine d'une zone, pour annuler une reformulation. */
const avantReformulation = new Map();

function courant() {
  return etat.parcours;
}

function marquerModifie() {
  if (!courant()) return;
  courant().modifie = true;
  majPied();
}

export function parcoursModifie() {
  return Boolean(courant() && courant().modifie);
}

// --- Champs élémentaires ----------------------------------------------------

function zoneTexte(bloc, valeurInitiale, onChange) {
  const saisie = creer("textarea", {
    attrs: { rows: bloc.lignes || 4, "aria-label": bloc.libelle },
    sur: {
      input: (evenement) => {
        onChange(evenement.target.value);
        marquerModifie();
      },
    },
  });
  saisie.value = valeurInitiale || "";

  const retour = creer("span", { classe: "zone-etat", attrs: { role: "status" } });

  const appliquer = (texte) => {
    saisie.value = texte;
    onChange(texte);
    marquerModifie();
  };

  const boutonAnnuler = creer(
    "button",
    {
      classe: "btn btn-secondaire btn-menu",
      attrs: { type: "button", hidden: true },
      sur: {
        click: () => {
          const precedent = avantReformulation.get(bloc.cle);
          if (precedent === undefined) return;
          appliquer(precedent);
          avantReformulation.delete(bloc.cle);
          boutonAnnuler.hidden = true;
          retour.textContent = "Reformulation annulée.";
        },
      },
    },
    [document.createTextNode("Annuler la reformulation")]
  );

  const reformuler = async () => {
    const source = saisie.value.trim();
    if (!source) {
      retour.textContent = "Rien à reformuler.";
      return;
    }
    boutonReformuler.disabled = true;
    retour.textContent = "Reformulation en cours…";
    try {
      const { texte } = await api.reformuler(source, bloc.libelle);
      avantReformulation.set(bloc.cle, saisie.value);
      appliquer(texte);
      boutonAnnuler.hidden = false;
      retour.textContent = "Texte remis au propre.";
    } catch (err) {
      // Le texte de l'éducateur n'est jamais perdu : en cas d'échec, il reste
      // exactement tel qu'il était.
      retour.textContent = err.message;
    } finally {
      boutonReformuler.disabled = false;
    }
  };

  const boutonReformuler = creer(
    "button",
    {
      classe: "btn btn-secondaire btn-menu",
      attrs: { type: "button" },
      sur: { click: reformuler },
    },
    [icone("etincelle"), document.createTextNode("Reformuler")]
  );

  const boutonMicro = creer(
    "button",
    { classe: "btn btn-secondaire btn-menu", attrs: { type: "button" } },
    [icone("micro"), document.createTextNode("Dicter")]
  );

  boutonMicro.addEventListener("pointerenter", dictee.preparer);
  boutonMicro.addEventListener("click", () => {
    dictee.basculer({
      onEtat: (phase, message) => {
        boutonMicro.classList.toggle("enregistre", phase === "enregistrement");
        boutonMicro.lastChild.textContent =
          phase === "enregistrement" ? "Arrêter" : "Dicter";
        retour.textContent = message;
      },
      onTexte: async (texte) => {
        const separateur = saisie.value.trim() ? "\n" : "";
        appliquer(saisie.value + separateur + texte);
        // La dictée est reformulée dans la foulée : c'est le moment où le
        // texte en a le plus besoin, et l'annulation reste à un clic.
        await reformuler();
      },
    });
  });

  return creer("div", { classe: "zone" }, [
    creer("label", { classe: "zone-libelle", texte: bloc.libelle }),
    bloc.aide ? creer("p", { classe: "aide", texte: bloc.aide }) : null,
    saisie,
    creer("div", { classe: "zone-barre" }, [
      boutonMicro,
      boutonReformuler,
      boutonAnnuler,
      retour,
    ]),
  ]);
}

function champCourt(champ, valeur, onChange) {
  let saisie;

  if (champ.saisie === "choix" && champ.options) {
    saisie = creer("select", {
      sur: {
        change: (evenement) => {
          onChange(evenement.target.value);
          marquerModifie();
        },
      },
    });
    saisie.append(creer("option", { texte: "—", attrs: { value: "" } }));
    for (const option of champ.options) {
      saisie.append(creer("option", { texte: option, attrs: { value: option } }));
    }
  } else {
    saisie = creer("input", {
      attrs: { type: champ.saisie === "date" ? "date" : "text" },
      sur: {
        input: (evenement) => {
          onChange(evenement.target.value);
          marquerModifie();
        },
      },
    });
  }

  saisie.value = valeur || "";

  return creer("label", { classe: "champ" }, [
    creer("span", { classe: "champ-label", texte: champ.libelle }),
    saisie,
    champ.aide ? creer("span", { classe: "aide", texte: champ.aide }) : null,
  ]);
}

// --- Blocs ------------------------------------------------------------------

function rendreChamps(bloc, contenu) {
  const valeurs = contenu[bloc.cle] || {};
  return creer("section", { classe: "bloc" }, [
    bloc.titre ? creer("h3", { classe: "bloc-titre", texte: bloc.titre }) : null,
    creer(
      "div",
      { classe: "grille-champs" },
      bloc.champs.map((champ) =>
        champCourt(champ, valeurs[champ.cle], (valeur) => {
          valeurs[champ.cle] = valeur;
          contenu[bloc.cle] = valeurs;
        })
      )
    ),
  ]);
}

/**
 * Grille de cotation. Un clic sur une case déjà cochée la décoche : une ligne
 * cotée par erreur doit pouvoir redevenir vide, une absence d'observation
 * n'est pas la même chose qu'un « Jamais ».
 */
function rendreTableau(bloc, modele, contenu) {
  const options = modele.echelles[bloc.echelle] || [];
  const valeurs = contenu[bloc.cle] || {};
  contenu[bloc.cle] = valeurs;

  const enTete = creer("tr", {}, [
    creer("th", { classe: "cotation-item", texte: "" }),
    ...options.map((option) => creer("th", { texte: option })),
  ]);

  const lignes = bloc.lignes.map((ligne) => {
    const cellules = options.map((option) => {
      const bouton = creer("input", {
        attrs: {
          type: "radio",
          name: `${bloc.cle}__${ligne.cle}`,
          value: option,
          "aria-label": `${ligne.libelle} : ${option}`,
        },
      });
      bouton.checked = valeurs[ligne.cle] === option;
      bouton.addEventListener("click", () => {
        if (valeurs[ligne.cle] === option) {
          bouton.checked = false;
          valeurs[ligne.cle] = "";
        } else {
          valeurs[ligne.cle] = option;
        }
        marquerModifie();
      });
      return creer("td", {}, [bouton]);
    });

    return creer("tr", {}, [
      creer("th", { classe: "cotation-item", attrs: { scope: "row" }, texte: ligne.libelle }),
      ...cellules,
    ]);
  });

  return creer("section", { classe: "bloc" }, [
    bloc.titre ? creer("h3", { classe: "bloc-titre", texte: bloc.titre }) : null,
    creer("div", { classe: "cotation-cadre" }, [
      creer("table", { classe: "cotation" }, [
        creer("thead", {}, [enTete]),
        creer("tbody", {}, lignes),
      ]),
    ]),
  ]);
}

function rendreListe(bloc, contenu) {
  const valeurs = Array.isArray(contenu[bloc.cle]) ? contenu[bloc.cle] : [];
  contenu[bloc.cle] = valeurs;

  const conteneur = creer("div", { classe: "liste-saisie" });

  const redessiner = () => {
    vider(conteneur);
    if (valeurs.length === 0) {
      conteneur.append(
        creer("p", { classe: "section-vide", texte: "Aucune ligne pour l'instant." })
      );
    }
    valeurs.forEach((valeur, index) => {
      const saisie = creer("input", {
        attrs: { type: "text", "aria-label": `${bloc.libelle} ${index + 1}` },
        sur: {
          input: (evenement) => {
            valeurs[index] = evenement.target.value;
            marquerModifie();
          },
        },
      });
      saisie.value = valeur;
      conteneur.append(
        creer("div", { classe: "liste-ligne" }, [
          saisie,
          creer(
            "button",
            {
              classe: "btn-icone",
              attrs: { type: "button", "aria-label": "Supprimer cette ligne" },
              sur: {
                click: () => {
                  valeurs.splice(index, 1);
                  marquerModifie();
                  redessiner();
                },
              },
            },
            [icone("corbeille")]
          ),
        ])
      );
    });
  };
  redessiner();

  return creer("section", { classe: "bloc" }, [
    creer("h3", { classe: "bloc-titre", texte: bloc.libelle }),
    bloc.aide ? creer("p", { classe: "aide", texte: bloc.aide }) : null,
    conteneur,
    creer(
      "button",
      {
        classe: "btn btn-secondaire ajouter-element",
        attrs: { type: "button" },
        sur: {
          click: () => {
            valeurs.push("");
            marquerModifie();
            redessiner();
          },
        },
      },
      [icone("plus"), document.createTextNode("Ajouter une ligne")]
    ),
  ]);
}

function celluleSaisie(colonne, valeur, onChange) {
  let saisie;
  if (colonne.saisie === "choix" && colonne.options) {
    saisie = creer("select", {
      attrs: { "aria-label": colonne.libelle },
      sur: {
        change: (evenement) => {
          onChange(evenement.target.value);
          marquerModifie();
        },
      },
    });
    saisie.append(creer("option", { texte: "—", attrs: { value: "" } }));
    for (const option of colonne.options) {
      saisie.append(creer("option", { texte: option, attrs: { value: option } }));
    }
  } else {
    saisie = creer("textarea", {
      attrs: { rows: 2, "aria-label": colonne.libelle },
      sur: {
        input: (evenement) => {
          onChange(evenement.target.value);
          marquerModifie();
        },
      },
    });
  }
  saisie.value = valeur || "";
  return saisie;
}

function rendreGrille(bloc, contenu) {
  const valeurs = contenu[bloc.cle] || {};
  contenu[bloc.cle] = valeurs;

  const lignes = bloc.lignes.map((ligne) => {
    const cellules = valeurs[ligne.cle] || {};
    valeurs[ligne.cle] = cellules;
    return creer("tr", {}, [
      creer("th", { classe: "grille-item", attrs: { scope: "row" }, texte: ligne.libelle }),
      ...bloc.colonnes.map((colonne) =>
        creer("td", {}, [
          celluleSaisie(colonne, cellules[colonne.cle], (valeur) => {
            cellules[colonne.cle] = valeur;
          }),
        ])
      ),
    ]);
  });

  return creer("section", { classe: "bloc" }, [
    bloc.titre ? creer("h3", { classe: "bloc-titre", texte: bloc.titre }) : null,
    creer("div", { classe: "cotation-cadre" }, [
      creer("table", { classe: "grille-tableau" }, [
        creer("thead", {}, [
          creer("tr", {}, [
            creer("th", { texte: bloc.enTeteLignes }),
            ...bloc.colonnes.map((colonne) => creer("th", { texte: colonne.libelle })),
          ]),
        ]),
        creer("tbody", {}, lignes),
      ]),
    ]),
  ]);
}

function rendreRepetable(bloc, contenu) {
  const valeurs = Array.isArray(contenu[bloc.cle]) ? contenu[bloc.cle] : [];
  contenu[bloc.cle] = valeurs;

  const corps = creer("tbody");
  const cadre = creer("div", { classe: "cotation-cadre" }, [
    creer("table", { classe: "grille-tableau" }, [
      creer("thead", {}, [
        creer("tr", {}, [
          ...bloc.colonnes.map((colonne) => creer("th", { texte: colonne.libelle })),
          creer("th", { texte: "" }),
        ]),
      ]),
      corps,
    ]),
  ]);

  const vide = creer("p", {
    classe: "section-vide",
    texte: "Aucun élément. Laissez vide si rien n'a été relevé sur la période.",
  });

  const redessiner = () => {
    vider(corps);
    cadre.hidden = valeurs.length === 0;
    vide.hidden = valeurs.length > 0;

    valeurs.forEach((entree, index) => {
      corps.append(
        creer("tr", {}, [
          ...bloc.colonnes.map((colonne) =>
            creer("td", {}, [
              celluleSaisie(colonne, entree[colonne.cle], (valeur) => {
                entree[colonne.cle] = valeur;
              }),
            ])
          ),
          creer("td", {}, [
            creer(
              "button",
              {
                classe: "btn-icone",
                attrs: { type: "button", "aria-label": "Supprimer cette ligne" },
                sur: {
                  click: () => {
                    valeurs.splice(index, 1);
                    marquerModifie();
                    redessiner();
                  },
                },
              },
              [icone("corbeille")]
            ),
          ]),
        ])
      );
    });
  };
  redessiner();

  return creer("section", { classe: "bloc" }, [
    bloc.titre ? creer("h3", { classe: "bloc-titre", texte: bloc.titre }) : null,
    vide,
    cadre,
    creer(
      "button",
      {
        classe: "btn btn-secondaire ajouter-element",
        attrs: { type: "button" },
        sur: {
          click: () => {
            valeurs.push(
              Object.fromEntries(bloc.colonnes.map((colonne) => [colonne.cle, ""]))
            );
            marquerModifie();
            redessiner();
          },
        },
      },
      [icone("plus"), document.createTextNode(bloc.libelleAjout)]
    ),
  ]);
}

function rendreBloc(bloc, modele, contenu) {
  switch (bloc.type) {
    case "champs":
      return rendreChamps(bloc, contenu);
    case "tableau":
      return rendreTableau(bloc, modele, contenu);
    case "texte":
      return zoneTexte(bloc, contenu[bloc.cle], (valeur) => {
        contenu[bloc.cle] = valeur;
      });
    case "liste":
      return rendreListe(bloc, contenu);
    case "grille":
      return rendreGrille(bloc, contenu);
    case "repetable":
      return rendreRepetable(bloc, contenu);
    default:
      return null;
  }
}

// --- Étapes -----------------------------------------------------------------

function dessinerEtape() {
  const parcours = courant();
  const etape = parcours.modele.etapes[parcours.etape];
  const total = parcours.modele.etapes.length;

  $("parcours-etape-titre").textContent = etape.titre;
  $("parcours-position").textContent = `Étape ${parcours.etape + 1} sur ${total}`;
  $("parcours-jauge-barre").style.width = `${((parcours.etape + 1) / total) * 100}%`;

  const intro = $("parcours-intro");
  intro.textContent = etape.intro || "";
  intro.hidden = !etape.intro;

  const corps = $("parcours-corps");
  vider(corps);
  avantReformulation.clear();
  for (const bloc of etape.blocs) {
    const noeud = rendreBloc(bloc, parcours.modele, parcours.contenu);
    if (noeud) corps.append(noeud);
  }
  corps.scrollTop = 0;

  majPied();
}

function majPied() {
  const parcours = courant();
  if (!parcours) return;
  const dernier = parcours.etape === parcours.modele.etapes.length - 1;

  $("parcours-precedent").disabled = parcours.etape === 0;
  $("parcours-suivant").hidden = dernier;
  $("parcours-terminer").hidden = !dernier;
  // État transitoire et attendu — l'enregistrement se fait au changement
  // d'étape. Le signaler en rouge alarmerait sans raison.
  statut(
    $("parcours-statut"),
    parcours.modifie ? "Enregistré au passage à l'étape suivante." : ""
  );
}

/**
 * Enregistre l'état courant. Appelé à chaque changement d'étape : un
 * formulaire de quatorze écrans ne doit pas pouvoir se perdre parce qu'on a
 * fermé l'onglet à la douzième.
 */
async function enregistrer({ silencieux = false } = {}) {
  const parcours = courant();
  if (!parcours) return false;

  dictee.arreter();
  const boutons = [
    $("parcours-precedent"),
    $("parcours-suivant"),
    $("parcours-terminer"),
    $("parcours-enregistrer"),
  ];
  boutons.forEach((bouton) => (bouton.disabled = true));

  try {
    await api.modifierBilan(parcours.bilan.id, { contenu: parcours.contenu });
    parcours.modifie = false;
    if (!silencieux) {
      notifier("Bilan enregistré.", "ok");
    }
    emettre("bilan-enregistre");
    return true;
  } catch (err) {
    statut($("parcours-statut"), err.message, "erreur");
    notifier(err.message, "erreur");
    return false;
  } finally {
    boutons.forEach((bouton) => (bouton.disabled = false));
    majPied();
  }
}

async function allerA(index) {
  const parcours = courant();
  if (!parcours) return;
  if (index < 0 || index >= parcours.modele.etapes.length) return;

  if (parcours.modifie && !(await enregistrer({ silencieux: true }))) {
    return;
  }
  parcours.etape = index;
  dessinerEtape();
  $("zone-travail").scrollTo({ top: 0 });
}

// --- Ouverture --------------------------------------------------------------

export function ouvrirParcours(bilan) {
  const modele = etat.modeles && etat.modeles[bilan.type_bilan];
  if (!modele) {
    notifier(`Trame « ${bilan.type_bilan} » inconnue.`, "erreur");
    return;
  }

  etat.parcours = {
    bilan,
    modele,
    contenu: structuredClone(bilan.contenu),
    etape: 0,
    modifie: false,
  };

  const beneficiaire = etat.beneficiaireCourant;
  $("parcours-titre").textContent = modele.nom;
  $("parcours-beneficiaire").textContent = beneficiaire
    ? `${beneficiaire.prenom} ${beneficiaire.nom}`
    : "";
  $("parcours-retour-libelle").textContent = beneficiaire
    ? `${beneficiaire.prenom} ${beneficiaire.nom}`
    : "Retour";

  dessinerEtape();
  emettre("vue", "parcours");
  $("zone-travail").scrollTo({ top: 0 });
}

// --- Lecture seule (bilan validé) -------------------------------------------

function valeurLisible(valeur) {
  const texte = valeur === null || valeur === undefined ? "" : String(valeur);
  return texte.trim()
    ? creer("span", { classe: "valeur", texte })
    : creer("span", { classe: "valeur valeur-vide", texte: "Non renseigné" });
}

function tableauLecture(enTetes, lignes) {
  return creer("div", { classe: "cotation-cadre" }, [
    creer("table", { classe: "grille-tableau" }, [
      creer("thead", {}, [
        creer("tr", {}, enTetes.map((titre) => creer("th", { texte: titre }))),
      ]),
      creer(
        "tbody",
        {},
        lignes.map((cellules) =>
          creer(
            "tr",
            {},
            cellules.map((cellule, index) =>
              index === 0
                ? creer("th", { attrs: { scope: "row" }, texte: cellule })
                : creer("td", {}, [valeurLisible(cellule)])
            )
          )
        )
      ),
    ]),
  ]);
}

function blocLecture(bloc, modele, contenu) {
  const valeurs = contenu[bloc.cle];

  switch (bloc.type) {
    case "champs": {
      const donnees = valeurs || {};
      return creer(
        "div",
        { classe: "grille-entete" },
        bloc.champs.map((champ) =>
          creer("div", { classe: "champ" }, [
            creer("span", { classe: "champ-label", texte: champ.libelle }),
            valeurLisible(donnees[champ.cle]),
          ])
        )
      );
    }

    case "tableau": {
      const donnees = valeurs || {};
      return creer("div", {}, [
        bloc.titre ? creer("h3", { classe: "bloc-titre", texte: bloc.titre }) : null,
        tableauLecture(
          ["", "Cotation"],
          bloc.lignes.map((ligne) => [ligne.libelle, donnees[ligne.cle]])
        ),
      ]);
    }

    case "texte":
      return creer("div", { classe: "champ" }, [
        creer("span", { classe: "champ-label", texte: bloc.libelle }),
        valeurLisible(valeurs),
      ]);

    case "liste": {
      const entrees = Array.isArray(valeurs) ? valeurs : [];
      return creer("div", { classe: "champ" }, [
        creer("span", { classe: "champ-label", texte: bloc.libelle }),
        entrees.length === 0
          ? creer("p", { classe: "section-vide", texte: "Aucune ligne." })
          : creer(
              "ul",
              { classe: "liste-lecture" },
              entrees.map((entree) => creer("li", { texte: entree }))
            ),
      ]);
    }

    case "grille": {
      const donnees = valeurs || {};
      return tableauLecture(
        [bloc.enTeteLignes, ...bloc.colonnes.map((colonne) => colonne.libelle)],
        bloc.lignes.map((ligne) => [
          ligne.libelle,
          ...bloc.colonnes.map((colonne) => (donnees[ligne.cle] || {})[colonne.cle]),
        ])
      );
    }

    case "repetable": {
      const entrees = Array.isArray(valeurs) ? valeurs : [];
      if (entrees.length === 0) {
        return creer("p", { classe: "section-vide", texte: "Aucun élément relevé." });
      }
      return tableauLecture(
        bloc.colonnes.map((colonne) => colonne.libelle),
        entrees.map((entree) => bloc.colonnes.map((colonne) => entree[colonne.cle]))
      );
    }

    default:
      return null;
  }
}

/**
 * Rendu d'un bilan à trame fixe une fois validé. La même trame sert au
 * formulaire, à l'export et à cette lecture : une section ne peut pas exister
 * à un endroit et manquer à l'autre.
 */
export function rendreModeleLectureSeule(modele, contenu, cible) {
  vider(cible);
  for (const etape of modele.etapes) {
    const section = creer("section", { classe: "section-bilan" }, [
      creer("h2", { texte: etape.titre }),
    ]);
    for (const bloc of etape.blocs) {
      const noeud = blocLecture(bloc, modele, contenu);
      if (noeud) section.append(noeud);
    }
    cible.append(section);
  }
}

export function confirmerAbandonParcours() {
  if (!parcoursModifie()) return true;
  return window.confirm(
    "Des modifications de ce bilan ne sont pas enregistrées. Quitter sans les enregistrer ?"
  );
}

export function initParcours() {
  $("parcours-precedent").addEventListener("click", () => allerA(courant().etape - 1));
  $("parcours-suivant").addEventListener("click", () => allerA(courant().etape + 1));
  $("parcours-enregistrer").addEventListener("click", () => enregistrer());

  $("parcours-terminer").addEventListener("click", async () => {
    if (!(await enregistrer({ silencieux: true }))) return;
    notifier("Bilan enregistré. Relisez-le avant de le valider.", "ok");
    const bilan = await api.bilan(courant().bilan.id);
    etat.parcours = null;
    emettre("ouvrir-bilan", { bilan, relecture: true });
  });

  $("parcours-retour").addEventListener("click", () => {
    if (!confirmerAbandonParcours()) return;
    dictee.arreter();
    etat.parcours = null;
    emettre("retour-beneficiaire");
  });
}
