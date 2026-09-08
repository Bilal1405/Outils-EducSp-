/**
 * Trames de bilan, pour la base locale du navigateur.
 *
 * FICHIER GÉNÉRÉ — ne pas modifier à la main.
 * Source : src/schema/. Régénérer avec : npm run generer:schema
 *
 * Ce que le serveur publie sur /api/schema/bilan et /api/schema/modeles,
 * mot pour mot : sans réseau, un praticien doit pouvoir ouvrir un bilan.
 */

export const SCHEMA_BILAN = {
  "domaines_competence": [
    "Autonomie vie quotidienne",
    "Prévention et traitement des comportements problèmes",
    "Émotions et comportements",
    "Communication",
    "Apprentissages scolaires/préprofessionnels",
    "Interactions sociales",
    "Activités sportives",
    "Autres"
  ],
  "types_comportement": [
    "Hétéro-agressivité",
    "Auto-agressivité",
    "Destructeur",
    "Perturbateur",
    "Répétitif",
    "Autres"
  ],
  "frequences_comportement": [
    "Moins d'une fois par mois",
    "Moins d'une fois par semaine",
    "1 à 10 fois par séance",
    "10 à 20 fois par séance",
    "Plus de 20 fois par séance",
    "Non observé"
  ]
};

export const MODELES_BILAN = {
  "types": [
    {
      "type": "bilan",
      "libelle": "Bilan"
    },
    {
      "type": "repit",
      "libelle": "Bilan de fin de séjour en répit"
    },
    {
      "type": "trimestriel",
      "libelle": "Bilan trimestriel"
    }
  ],
  "modeles": {
    "repit": {
      "type": "repit",
      "nom": "Bilan individuel de fin de séjour en Répit",
      "echelles": {
        "frequence": [
          "Jamais",
          "Parfois",
          "Souvent",
          "Toujours"
        ],
        "guidance": [
          "Guidance totale",
          "Guidance partielle",
          "Guidance légère",
          "Autonome"
        ],
        "moyen_communication": [
          "Verbal",
          "Pecs",
          "Makaton",
          "Pointage",
          "Autres"
        ]
      },
      "etapes": [
        {
          "cle": "sejour",
          "titre": "Séjour et participant",
          "intro": "Les informations d'identité proviennent de la fiche du bénéficiaire ; corrigez-les ici si le document doit en porter d'autres.",
          "blocs": [
            {
              "type": "champs",
              "cle": "sejour",
              "champs": [
                {
                  "cle": "nom_crl",
                  "libelle": "Nom du CRL"
                },
                {
                  "cle": "participant_nom",
                  "libelle": "Nom du participant"
                },
                {
                  "cle": "participant_prenom",
                  "libelle": "Prénom du participant"
                },
                {
                  "cle": "participant_date_naissance",
                  "libelle": "Date de naissance",
                  "saisie": "date"
                },
                {
                  "cle": "accueil_du",
                  "libelle": "Accueil du",
                  "saisie": "date"
                },
                {
                  "cle": "accueil_au",
                  "libelle": "Accueil au",
                  "saisie": "date"
                },
                {
                  "cle": "modalite_accueil",
                  "libelle": "Modalité d'accueil",
                  "saisie": "choix",
                  "options": [
                    "Temps plein",
                    "Temps partiel"
                  ]
                },
                {
                  "cle": "modalite_precision",
                  "libelle": "Précision si temps partiel",
                  "aide": "Jours ou demi-journées concernés."
                },
                {
                  "cle": "taux_encadrement",
                  "libelle": "Taux d'encadrement"
                }
              ]
            }
          ]
        },
        {
          "cle": "interlocuteurs",
          "titre": "Structure et interlocuteurs",
          "blocs": [
            {
              "type": "champs",
              "cle": "interlocuteurs",
              "champs": [
                {
                  "cle": "association",
                  "libelle": "Association"
                },
                {
                  "cle": "personne_referente",
                  "libelle": "Personne référente"
                },
                {
                  "cle": "mail",
                  "libelle": "Adresse électronique"
                },
                {
                  "cle": "telephone",
                  "libelle": "Téléphone"
                },
                {
                  "cle": "coordinateur_pcpe",
                  "libelle": "Coordinateur PCPE"
                },
                {
                  "cle": "liberal_pcpe",
                  "libelle": "Libéral du PCPE"
                }
              ]
            }
          ]
        },
        {
          "cle": "socialisation_pairs",
          "titre": "Socialisation — avec ses pairs",
          "intro": "Cotez le comportement observé pendant le séjour. Une ligne non cotée reste vide : elle signale une absence d'observation, pas une absence de compétence.",
          "blocs": [
            {
              "type": "tableau",
              "cle": "socialisation_pairs",
              "titre": "Avec les autres personnes accueillies",
              "echelle": "frequence",
              "lignes": [
                {
                  "cle": "reste_a_cote",
                  "libelle": "Reste à côté des autres"
                },
                {
                  "cle": "interaction",
                  "libelle": "Rentre en interaction"
                },
                {
                  "cle": "joue_avec",
                  "libelle": "Joue avec les autres"
                },
                {
                  "cle": "reste_groupe",
                  "libelle": "Reste dans le groupe"
                },
                {
                  "cle": "adapte",
                  "libelle": "Adapté dans ses interactions"
                }
              ]
            },
            {
              "type": "texte",
              "cle": "socialisation_pairs_commentaires",
              "libelle": "Commentaires",
              "lignes": 3
            }
          ]
        },
        {
          "cle": "socialisation_encadrants",
          "titre": "Socialisation — avec le personnel encadrant",
          "blocs": [
            {
              "type": "tableau",
              "cle": "socialisation_encadrants",
              "titre": "Avec le personnel encadrant",
              "echelle": "frequence",
              "lignes": [
                {
                  "cle": "interaction",
                  "libelle": "Rentre en interaction"
                },
                {
                  "cle": "adapte",
                  "libelle": "Adapté dans ses interactions"
                }
              ]
            },
            {
              "type": "texte",
              "cle": "socialisation_encadrants_commentaires",
              "libelle": "Commentaires",
              "lignes": 3
            }
          ]
        },
        {
          "cle": "langage_receptif_simple",
          "titre": "Communication — langage réceptif (1/2)",
          "intro": "Ce que la personne comprend : consignes simples et interdits.",
          "blocs": [
            {
              "type": "tableau",
              "cle": "langage_receptif",
              "titre": "Consignes simples et interdits",
              "echelle": "frequence",
              "lignes": [
                {
                  "cle": "prenom",
                  "libelle": "Répond à son prénom"
                },
                {
                  "cle": "comprend_simple",
                  "libelle": "Comprend les consignes simples (assieds-toi, lève-toi)"
                },
                {
                  "cle": "repond_simple",
                  "libelle": "Répond aux consignes simples"
                },
                {
                  "cle": "comprend_interdit",
                  "libelle": "Comprend l'interdit"
                },
                {
                  "cle": "accepte_interdit",
                  "libelle": "Accepte l'interdit"
                }
              ]
            },
            {
              "type": "texte",
              "cle": "langage_receptif_commentaires",
              "libelle": "Commentaires",
              "lignes": 3
            }
          ]
        },
        {
          "cle": "langage_receptif_complexe",
          "titre": "Communication — langage réceptif (2/2)",
          "intro": "Consignes complexes et consignes gestuelles.",
          "blocs": [
            {
              "type": "tableau",
              "cle": "langage_receptif_complexe",
              "titre": "Consignes complexes et gestuelles",
              "echelle": "frequence",
              "lignes": [
                {
                  "cle": "comprend_complexe",
                  "libelle": "Comprend les consignes complexes (lève-toi et prends le livre)"
                },
                {
                  "cle": "repond_complexe",
                  "libelle": "Répond aux consignes complexes"
                },
                {
                  "cle": "comprend_gestuelle",
                  "libelle": "Comprend les consignes gestuelles (Makaton, LSF)"
                },
                {
                  "cle": "repond_gestuelle",
                  "libelle": "Répond aux consignes gestuelles (signe de la main pour venir)"
                }
              ]
            },
            {
              "type": "texte",
              "cle": "langage_receptif_complexe_commentaires",
              "libelle": "Commentaires",
              "lignes": 3
            }
          ]
        },
        {
          "cle": "langage_expressif",
          "titre": "Communication — langage expressif",
          "intro": "Ce que la personne exprime.",
          "blocs": [
            {
              "type": "champs",
              "cle": "moyen_communication",
              "champs": [
                {
                  "cle": "moyen",
                  "libelle": "Moyen de communication principal",
                  "saisie": "choix",
                  "options": [
                    "Verbal",
                    "Pecs",
                    "Makaton",
                    "Pointage",
                    "Autres"
                  ]
                }
              ]
            },
            {
              "type": "tableau",
              "cle": "langage_expressif",
              "titre": "Demandes",
              "echelle": "frequence",
              "lignes": [
                {
                  "cle": "demandes",
                  "libelle": "Fait des demandes"
                },
                {
                  "cle": "pointe",
                  "libelle": "Pointe ou prend la main pour faire des demandes"
                },
                {
                  "cle": "demande_aide",
                  "libelle": "Demande de l'aide de façon adaptée"
                },
                {
                  "cle": "choix",
                  "libelle": "Sait faire des choix, avec ou sans guidance"
                }
              ]
            }
          ]
        },
        {
          "cle": "langage_expressif_regard",
          "titre": "Communication — regard et attention conjointe",
          "blocs": [
            {
              "type": "tableau",
              "cle": "langage_expressif_regard",
              "titre": "Regard et attention partagée",
              "echelle": "frequence",
              "lignes": [
                {
                  "cle": "contact_oculaire",
                  "libelle": "A un bon contact oculaire (regarde l'autre quand il communique)"
                },
                {
                  "cle": "attention_conjointe",
                  "libelle": "A une attention conjointe (partage de regards entre l'autre et un objet)"
                }
              ]
            },
            {
              "type": "texte",
              "cle": "langage_expressif_commentaires",
              "libelle": "Commentaires sur le langage expressif",
              "lignes": 4
            }
          ]
        },
        {
          "cle": "comportements",
          "titre": "Comportements",
          "blocs": [
            {
              "type": "tableau",
              "cle": "comportements",
              "titre": "Comportements observés",
              "echelle": "frequence",
              "lignes": [
                {
                  "cle": "hetero_agressivite",
                  "libelle": "Hétéro-agressivité (sur les autres)"
                },
                {
                  "cle": "auto_agressivite",
                  "libelle": "Auto-agressivité (sur lui-même)"
                },
                {
                  "cle": "destruction",
                  "libelle": "Casse, jette ou déchire des objets ; perturbateur dans le groupe"
                },
                {
                  "cle": "stereotypies",
                  "libelle": "Stéréotypies (balancement, agitation des mains, bruits répétés)"
                },
                {
                  "cle": "echolalies",
                  "libelle": "Écholalies"
                },
                {
                  "cle": "potomanie",
                  "libelle": "Potomanie (ingestion permanente de liquide en grande quantité)"
                },
                {
                  "cle": "pica",
                  "libelle": "Tendance au pica (ingestion de choses non comestibles)"
                }
              ]
            },
            {
              "type": "texte",
              "cle": "comportements_commentaires",
              "libelle": "Commentaires",
              "lignes": 3
            }
          ]
        },
        {
          "cle": "vie_quotidienne_hygiene",
          "titre": "Vie quotidienne — hygiène et toilettes",
          "blocs": [
            {
              "type": "tableau",
              "cle": "vie_quotidienne_hygiene",
              "titre": "Hygiène et toilettes",
              "echelle": "guidance",
              "lignes": [
                {
                  "cle": "lave_mains",
                  "libelle": "Se lave les mains"
                },
                {
                  "cle": "demande_toilettes",
                  "libelle": "Demande pour aller aux toilettes"
                },
                {
                  "cle": "baisser",
                  "libelle": "Sait baisser son pantalon et son sous-vêtement"
                },
                {
                  "cle": "assoir",
                  "libelle": "Sait s'asseoir sur les toilettes et faire ses besoins"
                },
                {
                  "cle": "essuie",
                  "libelle": "S'essuie"
                },
                {
                  "cle": "remettre",
                  "libelle": "Sait remettre son pantalon et son sous-vêtement"
                }
              ]
            },
            {
              "type": "texte",
              "cle": "vie_quotidienne_hygiene_commentaires",
              "libelle": "Commentaires",
              "lignes": 3
            }
          ]
        },
        {
          "cle": "vie_quotidienne_habillage",
          "titre": "Vie quotidienne — habillage",
          "blocs": [
            {
              "type": "tableau",
              "cle": "vie_quotidienne_habillage",
              "titre": "Habillage",
              "echelle": "guidance",
              "lignes": [
                {
                  "cle": "enleve_manteau",
                  "libelle": "Enlève son manteau"
                },
                {
                  "cle": "met_manteau",
                  "libelle": "Met son manteau"
                },
                {
                  "cle": "met_chaussures",
                  "libelle": "Met ses chaussures"
                },
                {
                  "cle": "enleve_chaussures",
                  "libelle": "Enlève ses chaussures"
                }
              ]
            },
            {
              "type": "texte",
              "cle": "vie_quotidienne_habillage_commentaires",
              "libelle": "Commentaires",
              "lignes": 3
            }
          ]
        },
        {
          "cle": "deplacements",
          "titre": "Déplacements",
          "blocs": [
            {
              "type": "tableau",
              "cle": "deplacements",
              "titre": "Déplacements et sécurité",
              "echelle": "guidance",
              "lignes": [
                {
                  "cle": "attache_voiture",
                  "libelle": "S'attache en voiture"
                },
                {
                  "cle": "detache_voiture",
                  "libelle": "Se détache en voiture"
                },
                {
                  "cle": "transports",
                  "libelle": "Respecte les règles de sécurité dans les transports en commun"
                },
                {
                  "cle": "pieton",
                  "libelle": "Respecte les règles de sécurité en tant que piéton"
                },
                {
                  "cle": "fugue",
                  "libelle": "Tendance à la fugue vers l'extérieur"
                }
              ]
            },
            {
              "type": "texte",
              "cle": "deplacements_commentaires",
              "libelle": "Commentaires",
              "lignes": 3
            }
          ]
        },
        {
          "cle": "repas_prise",
          "titre": "Repas — prise du repas",
          "blocs": [
            {
              "type": "tableau",
              "cle": "repas",
              "titre": "Se servir et manger",
              "echelle": "guidance",
              "lignes": [
                {
                  "cle": "servir_manger",
                  "libelle": "Sait se servir à manger"
                },
                {
                  "cle": "servir_boire",
                  "libelle": "Sait se servir à boire"
                },
                {
                  "cle": "manger",
                  "libelle": "Sait manger"
                },
                {
                  "cle": "couverts",
                  "libelle": "Sait manger avec des couverts classiques ou adaptés"
                },
                {
                  "cle": "couper",
                  "libelle": "Coupe sa nourriture"
                }
              ]
            },
            {
              "type": "texte",
              "cle": "repas_commentaires",
              "libelle": "Commentaires",
              "lignes": 3
            }
          ]
        },
        {
          "cle": "repas_tenue",
          "titre": "Repas — tenue à table",
          "blocs": [
            {
              "type": "tableau",
              "cle": "repas_tenue",
              "titre": "Tenue à table et participation",
              "echelle": "guidance",
              "lignes": [
                {
                  "cle": "reste_assis",
                  "libelle": "Reste assis"
                },
                {
                  "cle": "attend",
                  "libelle": "Attend"
                },
                {
                  "cle": "mettre_table",
                  "libelle": "Met la table"
                },
                {
                  "cle": "debarrasser",
                  "libelle": "Débarrasse la table"
                }
              ]
            },
            {
              "type": "texte",
              "cle": "repas_diversification",
              "libelle": "Y a-t-il un problème de diversification alimentaire ?",
              "lignes": 3
            }
          ]
        },
        {
          "cle": "loisirs",
          "titre": "Loisirs",
          "blocs": [
            {
              "type": "tableau",
              "cle": "loisirs",
              "titre": "Activités et jeux",
              "echelle": "frequence",
              "lignes": [
                {
                  "cle": "artistiques",
                  "libelle": "Réalise des activités artistiques pendant au moins 10 minutes"
                },
                {
                  "cle": "jeux_societe",
                  "libelle": "Joue à des jeux de société avec ses pairs pendant au moins 10 minutes"
                },
                {
                  "cle": "regles_jeux",
                  "libelle": "Comprend les règles des jeux de société"
                },
                {
                  "cle": "sport_individuel",
                  "libelle": "Participe à des activités sportives en individuel pendant au moins 10 minutes"
                },
                {
                  "cle": "sport_groupe",
                  "libelle": "Participe à des activités sportives en groupe pendant au moins 10 minutes"
                },
                {
                  "cle": "attend_tour",
                  "libelle": "Sait attendre son tour"
                }
              ]
            },
            {
              "type": "texte",
              "cle": "loisirs_commentaires",
              "libelle": "Commentaires",
              "lignes": 3
            }
          ]
        },
        {
          "cle": "motricite",
          "titre": "Motricité",
          "blocs": [
            {
              "type": "tableau",
              "cle": "motricite",
              "titre": "Motricité globale",
              "echelle": "frequence",
              "lignes": [
                {
                  "cle": "marche",
                  "libelle": "Marche de façon adaptée (sans chute, bonne coordination)"
                },
                {
                  "cle": "monte_escaliers",
                  "libelle": "Monte les escaliers de façon autonome"
                },
                {
                  "cle": "descend_escaliers",
                  "libelle": "Descend les escaliers de façon autonome"
                },
                {
                  "cle": "lance_ballon",
                  "libelle": "Lance un ballon à quelqu'un"
                },
                {
                  "cle": "court",
                  "libelle": "Sait courir ou trottiner"
                },
                {
                  "cle": "saute",
                  "libelle": "Sait sauter"
                },
                {
                  "cle": "grimpe",
                  "libelle": "Sait grimper"
                },
                {
                  "cle": "engins",
                  "libelle": "Sait utiliser un tricycle, un vélo, une trottinette"
                }
              ]
            },
            {
              "type": "texte",
              "cle": "motricite_commentaires",
              "libelle": "Commentaires",
              "lignes": 3
            }
          ]
        },
        {
          "cle": "sensoriel",
          "titre": "Particularités sensorielles",
          "blocs": [
            {
              "type": "tableau",
              "cle": "sensoriel",
              "titre": "Particularités sensorielles",
              "echelle": "frequence",
              "lignes": [
                {
                  "cle": "auditive",
                  "libelle": "Sensibilité auditive"
                },
                {
                  "cle": "contact",
                  "libelle": "Sensibilité au contact physique"
                },
                {
                  "cle": "gustative",
                  "libelle": "Sensibilité gustative"
                },
                {
                  "cle": "visuelle",
                  "libelle": "Sensibilité visuelle"
                },
                {
                  "cle": "auto_stimulation",
                  "libelle": "Comportement auto-stimulant"
                },
                {
                  "cle": "fatigabilite",
                  "libelle": "Fatigabilité"
                },
                {
                  "cle": "decharge",
                  "libelle": "Besoin de se décharger physiquement ou de se retirer"
                }
              ]
            },
            {
              "type": "texte",
              "cle": "sensoriel_commentaires",
              "libelle": "Commentaires",
              "lignes": 3
            }
          ]
        },
        {
          "cle": "signature",
          "titre": "Rédaction et transmission",
          "blocs": [
            {
              "type": "champs",
              "cle": "signature",
              "champs": [
                {
                  "cle": "redige_par",
                  "libelle": "Rédigé par"
                },
                {
                  "cle": "transmis_le",
                  "libelle": "Transmis le",
                  "saisie": "date"
                }
              ]
            }
          ]
        }
      ]
    },
    "trimestriel": {
      "type": "trimestriel",
      "nom": "Bilan trimestriel",
      "echelles": {},
      "etapes": [
        {
          "cle": "identification",
          "titre": "Période et bénéficiaire",
          "blocs": [
            {
              "type": "champs",
              "cle": "identification",
              "champs": [
                {
                  "cle": "periode_debut",
                  "libelle": "Période du",
                  "saisie": "date"
                },
                {
                  "cle": "periode_fin",
                  "libelle": "au",
                  "saisie": "date"
                },
                {
                  "cle": "beneficiaire",
                  "libelle": "Bénéficiaire"
                },
                {
                  "cle": "age",
                  "libelle": "Âge"
                }
              ]
            }
          ]
        },
        {
          "cle": "contexte",
          "titre": "Contexte de l'intervention",
          "blocs": [
            {
              "type": "champs",
              "cle": "contexte",
              "champs": [
                {
                  "cle": "intervenant",
                  "libelle": "Intervenant"
                },
                {
                  "cle": "jours_heures",
                  "libelle": "Jours et heures d'intervention"
                },
                {
                  "cle": "lieux",
                  "libelle": "Lieux"
                },
                {
                  "cle": "personnes_presentes",
                  "libelle": "Personnes présentes lors des interventions"
                },
                {
                  "cle": "premiere_rencontre",
                  "libelle": "Date de première rencontre",
                  "saisie": "date"
                },
                {
                  "cle": "debut_intervention",
                  "libelle": "Début d'intervention",
                  "saisie": "date"
                }
              ]
            }
          ]
        },
        {
          "cle": "objectifs",
          "titre": "Objectifs d'intervention",
          "intro": "Objectifs fixés par le PCPE pour la période couverte par ce bilan.",
          "blocs": [
            {
              "type": "liste",
              "cle": "objectifs_intervention",
              "libelle": "Objectifs",
              "aide": "Un objectif par ligne."
            }
          ]
        },
        {
          "cle": "comportements",
          "titre": "Comportements problèmes",
          "intro": "Une ligne par comportement observé. Laissez la section vide si aucun comportement problème n'a été relevé sur la période.",
          "blocs": [
            {
              "type": "repetable",
              "cle": "comportements_problemes",
              "libelleAjout": "Ajouter un comportement",
              "colonnes": [
                {
                  "cle": "type",
                  "libelle": "Type",
                  "saisie": "choix",
                  "options": [
                    "Hétéro-agressivité",
                    "Auto-agressivité",
                    "Destructeur",
                    "Perturbateur",
                    "Répétitif",
                    "Autres"
                  ]
                },
                {
                  "cle": "intensite",
                  "libelle": "Intensité",
                  "saisie": "choix",
                  "options": [
                    "Sévère",
                    "Modérée",
                    "Légère"
                  ]
                },
                {
                  "cle": "frequence",
                  "libelle": "Fréquence",
                  "saisie": "choix",
                  "options": [
                    "Moins d'une fois par mois",
                    "Moins d'une fois par semaine",
                    "Moins d'une fois par jour",
                    "1 à 10 fois par jour",
                    "10 à 20 fois par jour",
                    "Plus de 20 fois par jour"
                  ]
                },
                {
                  "cle": "commentaire",
                  "libelle": "Commentaire"
                }
              ]
            },
            {
              "type": "texte",
              "cle": "donnees_complementaires",
              "libelle": "Données complémentaires",
              "lignes": 3
            }
          ]
        },
        {
          "cle": "freins",
          "titre": "Freins potentiels",
          "blocs": [
            {
              "type": "texte",
              "cle": "freins_potentiels",
              "libelle": "Freins potentiels",
              "aide": "Ce qui a limité ou pourrait limiter la progression sur la période.",
              "lignes": 8
            }
          ]
        },
        {
          "cle": "axes",
          "titre": "Axes d'amélioration et préconisations",
          "blocs": [
            {
              "type": "texte",
              "cle": "axes_ameliorations",
              "libelle": "Axes d'amélioration et préconisations",
              "lignes": 8
            }
          ]
        },
        {
          "cle": "communication",
          "titre": "Domaine de compétences en communication",
          "blocs": [
            {
              "type": "texte",
              "cle": "domaine_communication",
              "libelle": "Observations",
              "lignes": 9
            }
          ]
        },
        {
          "cle": "cognitif",
          "titre": "Domaine de compétences cognitives",
          "blocs": [
            {
              "type": "texte",
              "cle": "domaine_cognitif",
              "libelle": "Observations",
              "lignes": 9
            }
          ]
        },
        {
          "cle": "autonomie",
          "titre": "Domaine de compétences de la vie quotidienne",
          "blocs": [
            {
              "type": "texte",
              "cle": "domaine_autonomie",
              "libelle": "Observations",
              "lignes": 9
            }
          ]
        },
        {
          "cle": "socialisation",
          "titre": "Socialisation, habiletés sociales, sexualité",
          "blocs": [
            {
              "type": "texte",
              "cle": "domaine_socialisation",
              "libelle": "Observations",
              "lignes": 9
            }
          ]
        },
        {
          "cle": "motricite",
          "titre": "Motricité et sensorialité",
          "blocs": [
            {
              "type": "texte",
              "cle": "domaine_motricite",
              "libelle": "Observations",
              "lignes": 9
            }
          ]
        },
        {
          "cle": "propositions",
          "titre": "Propositions pour la période suivante",
          "intro": "À valider par le PCPE.",
          "blocs": [
            {
              "type": "grille",
              "cle": "propositions",
              "enTeteLignes": "Domaine de compétence",
              "lignes": [
                {
                  "cle": "comportement",
                  "libelle": "Comportement"
                },
                {
                  "cle": "communication",
                  "libelle": "Communication"
                },
                {
                  "cle": "cognitives",
                  "libelle": "Cognitives"
                },
                {
                  "cle": "autonomie",
                  "libelle": "Autonomie"
                },
                {
                  "cle": "socialisation",
                  "libelle": "Socialisation / habiletés sociales / sexualité"
                },
                {
                  "cle": "motricite",
                  "libelle": "Motricité"
                }
              ],
              "colonnes": [
                {
                  "cle": "objectifs",
                  "libelle": "Objectifs"
                },
                {
                  "cle": "interventions",
                  "libelle": "Interventions"
                }
              ]
            }
          ]
        }
      ]
    }
  }
};
