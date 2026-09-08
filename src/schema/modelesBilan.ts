/**
 * Description des bilans à trame fixe (Répit, Trimestriel).
 *
 * Ces deux bilans reprennent des documents Word existants : une suite de
 * sections, de grilles de cotation et de zones de commentaire. La trame est
 * décrite ici **une seule fois**, sous forme de données, et sert trois usages :
 *
 *  - la validation Zod du contenu enregistré (`schemaDepuisModele`) ;
 *  - la construction du formulaire guidé côté navigateur, qui reçoit ces
 *    mêmes données par `/api/schema/modeles` ;
 *  - l'export .docx, qui parcourt la trame pour restituer le document.
 *
 * Recopier ces listes dans le navigateur ou dans l'export en ferait deux
 * définitions concurrentes : une ligne ajoutée à une grille disparaîtrait
 * silencieusement de l'un des trois.
 *
 * Découpage en étapes : chaque étape doit tenir dans une hauteur d'écran, sans
 * défilement. C'est ce qui dicte le regroupement des blocs, pas la structure du
 * document d'origine.
 */

export const TYPES_BILAN = ["bilan", "repit", "trimestriel"] as const;
export type TypeBilan = (typeof TYPES_BILAN)[number];

export const LIBELLES_TYPE_BILAN: Record<TypeBilan, string> = {
  bilan: "Bilan",
  repit: "Bilan de fin de séjour en répit",
  trimestriel: "Bilan trimestriel",
};

// --- Blocs ------------------------------------------------------------------

/** Champ court : une ligne de saisie, éventuellement contrainte. */
export interface ChampCourt {
  cle: string;
  libelle: string;
  /** `choix` affiche une liste fermée, `date` un sélecteur de date. */
  saisie?: "texte" | "date" | "choix";
  options?: readonly string[];
  aide?: string;
}

export interface BlocChamps {
  type: "champs";
  cle: string;
  titre?: string;
  champs: readonly ChampCourt[];
}

/** Grille de cotation : une ligne par item, une seule case cochée par ligne. */
export interface BlocTableau {
  type: "tableau";
  cle: string;
  titre?: string;
  intro?: string;
  echelle: string;
  lignes: readonly { cle: string; libelle: string }[];
}

/** Zone de texte longue : dictable, et reformulable par le moteur. */
export interface BlocTexte {
  type: "texte";
  cle: string;
  libelle: string;
  aide?: string;
  lignes?: number;
}

/** Liste à puces saisie ligne à ligne. */
export interface BlocListe {
  type: "liste";
  cle: string;
  libelle: string;
  aide?: string;
}

export interface ColonneGrille {
  cle: string;
  libelle: string;
  saisie?: "texte" | "choix";
  options?: readonly string[];
}

/** Tableau à lignes imposées et colonnes libres. */
export interface BlocGrille {
  type: "grille";
  cle: string;
  titre?: string;
  intro?: string;
  enTeteLignes: string;
  lignes: readonly { cle: string; libelle: string }[];
  colonnes: readonly ColonneGrille[];
}

/** Tableau dont les lignes sont ajoutées par l'éducateur. */
export interface BlocRepetable {
  type: "repetable";
  cle: string;
  titre?: string;
  intro?: string;
  libelleAjout: string;
  colonnes: readonly ColonneGrille[];
}

export type BlocBilan =
  | BlocChamps
  | BlocTableau
  | BlocTexte
  | BlocListe
  | BlocGrille
  | BlocRepetable;

export interface EtapeBilan {
  cle: string;
  titre: string;
  intro?: string;
  blocs: readonly BlocBilan[];
}

export interface ModeleBilan {
  type: Exclude<TypeBilan, "bilan">;
  nom: string;
  /** Échelles de cotation, référencées par `BlocTableau.echelle`. */
  echelles: Record<string, readonly string[]>;
  etapes: readonly EtapeBilan[];
}

// --- Échelles partagées -----------------------------------------------------

const FREQUENCE_4 = ["Jamais", "Parfois", "Souvent", "Toujours"] as const;
const GUIDANCE_4 = [
  "Guidance totale",
  "Guidance partielle",
  "Guidance légère",
  "Autonome",
] as const;
const MOYENS_COMMUNICATION = [
  "Verbal",
  "Pecs",
  "Makaton",
  "Pointage",
  "Autres",
] as const;

/** Raccourci : une grille de cotation suivie de sa zone de commentaire. */
function grilleCommentee(
  cle: string,
  titre: string,
  echelle: string,
  lignes: readonly [string, string][],
  libelleCommentaire = "Commentaires"
): readonly BlocBilan[] {
  return [
    {
      type: "tableau",
      cle,
      titre,
      echelle,
      lignes: lignes.map(([c, libelle]) => ({ cle: c, libelle })),
    },
    {
      type: "texte",
      cle: `${cle}_commentaires`,
      libelle: libelleCommentaire,
      lignes: 3,
    },
  ];
}

// --- Bilan de fin de séjour en répit ----------------------------------------

export const MODELE_REPIT: ModeleBilan = {
  type: "repit",
  nom: "Bilan individuel de fin de séjour en Répit",
  echelles: {
    frequence: FREQUENCE_4,
    guidance: GUIDANCE_4,
    moyen_communication: MOYENS_COMMUNICATION,
  },
  etapes: [
    {
      cle: "sejour",
      titre: "Séjour et participant",
      intro:
        "Les informations d'identité proviennent de la fiche du bénéficiaire ; corrigez-les ici si le document doit en porter d'autres.",
      blocs: [
        {
          type: "champs",
          cle: "sejour",
          champs: [
            { cle: "nom_crl", libelle: "Nom du CRL" },
            { cle: "participant_nom", libelle: "Nom du participant" },
            { cle: "participant_prenom", libelle: "Prénom du participant" },
            {
              cle: "participant_date_naissance",
              libelle: "Date de naissance",
              saisie: "date",
            },
            { cle: "accueil_du", libelle: "Accueil du", saisie: "date" },
            { cle: "accueil_au", libelle: "Accueil au", saisie: "date" },
            {
              cle: "modalite_accueil",
              libelle: "Modalité d'accueil",
              saisie: "choix",
              options: ["Temps plein", "Temps partiel"],
            },
            {
              cle: "modalite_precision",
              libelle: "Précision si temps partiel",
              aide: "Jours ou demi-journées concernés.",
            },
            { cle: "taux_encadrement", libelle: "Taux d'encadrement" },
          ],
        },
      ],
    },
    {
      cle: "interlocuteurs",
      titre: "Structure et interlocuteurs",
      blocs: [
        {
          type: "champs",
          cle: "interlocuteurs",
          champs: [
            { cle: "association", libelle: "Association" },
            { cle: "personne_referente", libelle: "Personne référente" },
            { cle: "mail", libelle: "Adresse électronique" },
            { cle: "telephone", libelle: "Téléphone" },
            { cle: "coordinateur_pcpe", libelle: "Coordinateur PCPE" },
            { cle: "liberal_pcpe", libelle: "Libéral du PCPE" },
          ],
        },
      ],
    },
    {
      cle: "socialisation_pairs",
      titre: "Socialisation — avec ses pairs",
      intro:
        "Cotez le comportement observé pendant le séjour. Une ligne non cotée reste vide : elle signale une absence d'observation, pas une absence de compétence.",
      blocs: grilleCommentee("socialisation_pairs", "Avec les autres personnes accueillies", "frequence", [
        ["reste_a_cote", "Reste à côté des autres"],
        ["interaction", "Rentre en interaction"],
        ["joue_avec", "Joue avec les autres"],
        ["reste_groupe", "Reste dans le groupe"],
        ["adapte", "Adapté dans ses interactions"],
      ]),
    },
    {
      cle: "socialisation_encadrants",
      titre: "Socialisation — avec le personnel encadrant",
      blocs: grilleCommentee("socialisation_encadrants", "Avec le personnel encadrant", "frequence", [
        ["interaction", "Rentre en interaction"],
        ["adapte", "Adapté dans ses interactions"],
      ]),
    },
    // Le langage réceptif compte neuf items dans le document d'origine : trop
    // pour un écran une fois la zone de commentaire posée. Il est scindé en
    // deux étapes, sur une frontière qui a du sens — consignes simples d'un
    // côté, complexes et gestuelles de l'autre.
    {
      cle: "langage_receptif_simple",
      titre: "Communication — langage réceptif (1/2)",
      intro: "Ce que la personne comprend : consignes simples et interdits.",
      blocs: grilleCommentee("langage_receptif", "Consignes simples et interdits", "frequence", [
        ["prenom", "Répond à son prénom"],
        ["comprend_simple", "Comprend les consignes simples (assieds-toi, lève-toi)"],
        ["repond_simple", "Répond aux consignes simples"],
        ["comprend_interdit", "Comprend l'interdit"],
        ["accepte_interdit", "Accepte l'interdit"],
      ]),
    },
    {
      cle: "langage_receptif_complexe",
      titre: "Communication — langage réceptif (2/2)",
      intro: "Consignes complexes et consignes gestuelles.",
      blocs: grilleCommentee(
        "langage_receptif_complexe",
        "Consignes complexes et gestuelles",
        "frequence",
        [
          ["comprend_complexe", "Comprend les consignes complexes (lève-toi et prends le livre)"],
          ["repond_complexe", "Répond aux consignes complexes"],
          ["comprend_gestuelle", "Comprend les consignes gestuelles (Makaton, LSF)"],
          ["repond_gestuelle", "Répond aux consignes gestuelles (signe de la main pour venir)"],
        ]
      ),
    },
    {
      cle: "langage_expressif",
      titre: "Communication — langage expressif",
      intro: "Ce que la personne exprime.",
      blocs: [
        // Le document présente le moyen de communication sous forme de tableau,
        // mais c'est un choix unique : une liste déroulante dit la même chose
        // en un cinquième de la hauteur, et laisse l'étape tenir dans l'écran.
        {
          type: "champs",
          cle: "moyen_communication",
          champs: [
            {
              cle: "moyen",
              libelle: "Moyen de communication principal",
              saisie: "choix",
              options: MOYENS_COMMUNICATION,
            },
          ],
        },
        {
          type: "tableau",
          cle: "langage_expressif",
          titre: "Demandes",
          echelle: "frequence",
          lignes: [
            { cle: "demandes", libelle: "Fait des demandes" },
            { cle: "pointe", libelle: "Pointe ou prend la main pour faire des demandes" },
            { cle: "demande_aide", libelle: "Demande de l'aide de façon adaptée" },
            { cle: "choix", libelle: "Sait faire des choix, avec ou sans guidance" },
          ],
        },
      ],
    },
    {
      // Le document ne porte qu'un commentaire pour tout le langage expressif :
      // il est placé ici, en fin de section, plutôt que dupliqué.
      cle: "langage_expressif_regard",
      titre: "Communication — regard et attention conjointe",
      blocs: [
        {
          type: "tableau",
          cle: "langage_expressif_regard",
          titre: "Regard et attention partagée",
          echelle: "frequence",
          lignes: [
            { cle: "contact_oculaire", libelle: "A un bon contact oculaire (regarde l'autre quand il communique)" },
            { cle: "attention_conjointe", libelle: "A une attention conjointe (partage de regards entre l'autre et un objet)" },
          ],
        },
        {
          type: "texte",
          cle: "langage_expressif_commentaires",
          libelle: "Commentaires sur le langage expressif",
          lignes: 4,
        },
      ],
    },
    {
      cle: "comportements",
      titre: "Comportements",
      blocs: grilleCommentee("comportements", "Comportements observés", "frequence", [
        ["hetero_agressivite", "Hétéro-agressivité (sur les autres)"],
        ["auto_agressivite", "Auto-agressivité (sur lui-même)"],
        ["destruction", "Casse, jette ou déchire des objets ; perturbateur dans le groupe"],
        ["stereotypies", "Stéréotypies (balancement, agitation des mains, bruits répétés)"],
        ["echolalies", "Écholalies"],
        ["potomanie", "Potomanie (ingestion permanente de liquide en grande quantité)"],
        ["pica", "Tendance au pica (ingestion de choses non comestibles)"],
      ]),
    },
    {
      cle: "vie_quotidienne_hygiene",
      titre: "Vie quotidienne — hygiène et toilettes",
      blocs: grilleCommentee("vie_quotidienne_hygiene", "Hygiène et toilettes", "guidance", [
        ["lave_mains", "Se lave les mains"],
        ["demande_toilettes", "Demande pour aller aux toilettes"],
        ["baisser", "Sait baisser son pantalon et son sous-vêtement"],
        ["assoir", "Sait s'asseoir sur les toilettes et faire ses besoins"],
        ["essuie", "S'essuie"],
        ["remettre", "Sait remettre son pantalon et son sous-vêtement"],
      ]),
    },
    {
      cle: "vie_quotidienne_habillage",
      titre: "Vie quotidienne — habillage",
      blocs: grilleCommentee("vie_quotidienne_habillage", "Habillage", "guidance", [
        ["enleve_manteau", "Enlève son manteau"],
        ["met_manteau", "Met son manteau"],
        ["met_chaussures", "Met ses chaussures"],
        ["enleve_chaussures", "Enlève ses chaussures"],
      ]),
    },
    {
      cle: "deplacements",
      titre: "Déplacements",
      blocs: grilleCommentee("deplacements", "Déplacements et sécurité", "guidance", [
        ["attache_voiture", "S'attache en voiture"],
        ["detache_voiture", "Se détache en voiture"],
        ["transports", "Respecte les règles de sécurité dans les transports en commun"],
        ["pieton", "Respecte les règles de sécurité en tant que piéton"],
        ["fugue", "Tendance à la fugue vers l'extérieur"],
      ]),
    },
    {
      cle: "repas_prise",
      titre: "Repas — prise du repas",
      blocs: grilleCommentee("repas", "Se servir et manger", "guidance", [
        ["servir_manger", "Sait se servir à manger"],
        ["servir_boire", "Sait se servir à boire"],
        ["manger", "Sait manger"],
        ["couverts", "Sait manger avec des couverts classiques ou adaptés"],
        ["couper", "Coupe sa nourriture"],
      ]),
    },
    {
      cle: "repas_tenue",
      titre: "Repas — tenue à table",
      blocs: [
        {
          type: "tableau",
          cle: "repas_tenue",
          titre: "Tenue à table et participation",
          echelle: "guidance",
          lignes: [
            { cle: "reste_assis", libelle: "Reste assis" },
            { cle: "attend", libelle: "Attend" },
            { cle: "mettre_table", libelle: "Met la table" },
            { cle: "debarrasser", libelle: "Débarrasse la table" },
          ],
        },
        {
          type: "texte",
          cle: "repas_diversification",
          libelle: "Y a-t-il un problème de diversification alimentaire ?",
          lignes: 3,
        },
      ],
    },
    {
      cle: "loisirs",
      titre: "Loisirs",
      blocs: grilleCommentee("loisirs", "Activités et jeux", "frequence", [
        ["artistiques", "Réalise des activités artistiques pendant au moins 10 minutes"],
        ["jeux_societe", "Joue à des jeux de société avec ses pairs pendant au moins 10 minutes"],
        ["regles_jeux", "Comprend les règles des jeux de société"],
        ["sport_individuel", "Participe à des activités sportives en individuel pendant au moins 10 minutes"],
        ["sport_groupe", "Participe à des activités sportives en groupe pendant au moins 10 minutes"],
        ["attend_tour", "Sait attendre son tour"],
      ]),
    },
    {
      cle: "motricite",
      titre: "Motricité",
      blocs: grilleCommentee("motricite", "Motricité globale", "frequence", [
        ["marche", "Marche de façon adaptée (sans chute, bonne coordination)"],
        ["monte_escaliers", "Monte les escaliers de façon autonome"],
        ["descend_escaliers", "Descend les escaliers de façon autonome"],
        ["lance_ballon", "Lance un ballon à quelqu'un"],
        ["court", "Sait courir ou trottiner"],
        ["saute", "Sait sauter"],
        ["grimpe", "Sait grimper"],
        ["engins", "Sait utiliser un tricycle, un vélo, une trottinette"],
      ]),
    },
    {
      cle: "sensoriel",
      titre: "Particularités sensorielles",
      blocs: grilleCommentee("sensoriel", "Particularités sensorielles", "frequence", [
        ["auditive", "Sensibilité auditive"],
        ["contact", "Sensibilité au contact physique"],
        ["gustative", "Sensibilité gustative"],
        ["visuelle", "Sensibilité visuelle"],
        ["auto_stimulation", "Comportement auto-stimulant"],
        ["fatigabilite", "Fatigabilité"],
        ["decharge", "Besoin de se décharger physiquement ou de se retirer"],
      ]),
    },
    {
      cle: "signature",
      titre: "Rédaction et transmission",
      blocs: [
        {
          type: "champs",
          cle: "signature",
          champs: [
            { cle: "redige_par", libelle: "Rédigé par" },
            { cle: "transmis_le", libelle: "Transmis le", saisie: "date" },
          ],
        },
      ],
    },
  ],
};

// --- Bilan trimestriel ------------------------------------------------------

const TYPES_COMPORTEMENT_TRIMESTRIEL = [
  "Hétéro-agressivité",
  "Auto-agressivité",
  "Destructeur",
  "Perturbateur",
  "Répétitif",
  "Autres",
] as const;

const INTENSITES_COMPORTEMENT = ["Sévère", "Modérée", "Légère"] as const;

const FREQUENCES_COMPORTEMENT_TRIMESTRIEL = [
  "Moins d'une fois par mois",
  "Moins d'une fois par semaine",
  "Moins d'une fois par jour",
  "1 à 10 fois par jour",
  "10 à 20 fois par jour",
  "Plus de 20 fois par jour",
] as const;

/** Lignes imposées du tableau de propositions, dans l'ordre du document. */
const DOMAINES_PROPOSITION = [
  { cle: "comportement", libelle: "Comportement" },
  { cle: "communication", libelle: "Communication" },
  { cle: "cognitives", libelle: "Cognitives" },
  { cle: "autonomie", libelle: "Autonomie" },
  { cle: "socialisation", libelle: "Socialisation / habiletés sociales / sexualité" },
  { cle: "motricite", libelle: "Motricité" },
] as const;

export const MODELE_TRIMESTRIEL: ModeleBilan = {
  type: "trimestriel",
  nom: "Bilan trimestriel",
  echelles: {},
  etapes: [
    {
      cle: "identification",
      titre: "Période et bénéficiaire",
      blocs: [
        {
          type: "champs",
          cle: "identification",
          champs: [
            { cle: "periode_debut", libelle: "Période du", saisie: "date" },
            { cle: "periode_fin", libelle: "au", saisie: "date" },
            { cle: "beneficiaire", libelle: "Bénéficiaire" },
            { cle: "age", libelle: "Âge" },
          ],
        },
      ],
    },
    {
      cle: "contexte",
      titre: "Contexte de l'intervention",
      blocs: [
        {
          type: "champs",
          cle: "contexte",
          champs: [
            { cle: "intervenant", libelle: "Intervenant" },
            { cle: "jours_heures", libelle: "Jours et heures d'intervention" },
            { cle: "lieux", libelle: "Lieux" },
            { cle: "personnes_presentes", libelle: "Personnes présentes lors des interventions" },
            { cle: "premiere_rencontre", libelle: "Date de première rencontre", saisie: "date" },
            { cle: "debut_intervention", libelle: "Début d'intervention", saisie: "date" },
          ],
        },
      ],
    },
    {
      cle: "objectifs",
      titre: "Objectifs d'intervention",
      intro: "Objectifs fixés par le PCPE pour la période couverte par ce bilan.",
      blocs: [
        {
          type: "liste",
          cle: "objectifs_intervention",
          libelle: "Objectifs",
          aide: "Un objectif par ligne.",
        },
      ],
    },
    {
      cle: "comportements",
      titre: "Comportements problèmes",
      intro:
        "Une ligne par comportement observé. Laissez la section vide si aucun comportement problème n'a été relevé sur la période.",
      blocs: [
        {
          type: "repetable",
          cle: "comportements_problemes",
          libelleAjout: "Ajouter un comportement",
          colonnes: [
            {
              cle: "type",
              libelle: "Type",
              saisie: "choix",
              options: TYPES_COMPORTEMENT_TRIMESTRIEL,
            },
            {
              cle: "intensite",
              libelle: "Intensité",
              saisie: "choix",
              options: INTENSITES_COMPORTEMENT,
            },
            {
              cle: "frequence",
              libelle: "Fréquence",
              saisie: "choix",
              options: FREQUENCES_COMPORTEMENT_TRIMESTRIEL,
            },
            { cle: "commentaire", libelle: "Commentaire" },
          ],
        },
        {
          type: "texte",
          cle: "donnees_complementaires",
          libelle: "Données complémentaires",
          lignes: 3,
        },
      ],
    },
    {
      cle: "freins",
      titre: "Freins potentiels",
      blocs: [
        {
          type: "texte",
          cle: "freins_potentiels",
          libelle: "Freins potentiels",
          aide: "Ce qui a limité ou pourrait limiter la progression sur la période.",
          lignes: 8,
        },
      ],
    },
    {
      cle: "axes",
      titre: "Axes d'amélioration et préconisations",
      blocs: [
        {
          type: "texte",
          cle: "axes_ameliorations",
          libelle: "Axes d'amélioration et préconisations",
          lignes: 8,
        },
      ],
    },
    {
      cle: "communication",
      titre: "Domaine de compétences en communication",
      blocs: [
        {
          type: "texte",
          cle: "domaine_communication",
          libelle: "Observations",
          lignes: 9,
        },
      ],
    },
    {
      cle: "cognitif",
      titre: "Domaine de compétences cognitives",
      blocs: [
        { type: "texte", cle: "domaine_cognitif", libelle: "Observations", lignes: 9 },
      ],
    },
    {
      cle: "autonomie",
      titre: "Domaine de compétences de la vie quotidienne",
      blocs: [
        { type: "texte", cle: "domaine_autonomie", libelle: "Observations", lignes: 9 },
      ],
    },
    {
      cle: "socialisation",
      titre: "Socialisation, habiletés sociales, sexualité",
      blocs: [
        { type: "texte", cle: "domaine_socialisation", libelle: "Observations", lignes: 9 },
      ],
    },
    {
      cle: "motricite",
      titre: "Motricité et sensorialité",
      blocs: [
        { type: "texte", cle: "domaine_motricite", libelle: "Observations", lignes: 9 },
      ],
    },
    {
      cle: "propositions",
      titre: "Propositions pour la période suivante",
      intro: "À valider par le PCPE.",
      blocs: [
        {
          type: "grille",
          cle: "propositions",
          enTeteLignes: "Domaine de compétence",
          lignes: DOMAINES_PROPOSITION,
          colonnes: [
            { cle: "objectifs", libelle: "Objectifs" },
            { cle: "interventions", libelle: "Interventions" },
          ],
        },
      ],
    },
  ],
};

export const MODELES: Record<Exclude<TypeBilan, "bilan">, ModeleBilan> = {
  repit: MODELE_REPIT,
  trimestriel: MODELE_TRIMESTRIEL,
};

/** Parcourt tous les blocs d'un modèle, étapes confondues. */
export function blocsDuModele(modele: ModeleBilan): BlocBilan[] {
  return modele.etapes.flatMap((etape) => [...etape.blocs]);
}

/**
 * Clés des zones de texte, seules candidates à la reformulation par le moteur.
 * Une grille de cotation n'est jamais reformulée : c'est une observation
 * chiffrée, pas une rédaction.
 */
export function clesTexteReformulables(modele: ModeleBilan): string[] {
  return blocsDuModele(modele)
    .filter((bloc): bloc is BlocTexte => bloc.type === "texte")
    .map((bloc) => bloc.cle);
}
