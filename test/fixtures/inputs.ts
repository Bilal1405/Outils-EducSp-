/**
 * Corpus de test fictif — aucune donnée patient réelle (cf. note de
 * confidentialité de SPEC-moteur-bilan.md). Utilisé pour valider que la
 * sortie du moteur respecte strictement le schéma JSON du bilan.
 */

export interface CorpusEntry {
  id: string;
  description: string;
  texte: string;
}

export const corpusEntries: CorpusEntry[] = [
  {
    id: "cas-01-autonomie",
    description: "Travail sur l'autonomie du repas, comportement calme",
    texte:
      "Léo, 8 ans, suivi les lundis et jeudis de 14h à 16h à domicile avec sa mère présente. " +
      "Séances animées par Camille Dupont, éducatrice spécialisée. Sur la période, travail sur " +
      "l'autonomie au repas : Léo a progressé sur l'usage des couverts avec guidance physique " +
      "réduite de moitié. Aucun comportement problème observé pendant les séances. " +
      "Poursuite envisagée sur l'habillage seul la prochaine période.",
  },
  {
    id: "cas-02-comportement-agressif",
    description: "Comportements hétéro-agressifs fréquents, communication en cours",
    texte:
      "Bénéficiaire suivi au sein du foyer, 14 ans, intervention 3 fois par semaine par Karim " +
      "Belaid, moniteur-éducateur, et Sophie Martin, psychologue. Sur la période, plusieurs " +
      "épisodes d'hétéro-agressivité envers les pairs, observés environ 5 à 8 fois par séance " +
      "lors des transitions d'activité. Mise en place d'un pictogramme de communication pour " +
      "anticiper les transitions, avec un effet positif en fin de période. Objectif prochain : " +
      "renforcer l'usage du pictogramme en autonomie.",
  },
  {
    id: "cas-03-apprentissages",
    description: "Apprentissages scolaires, pas d'information sur naissance",
    texte:
      "Intervention en école ordinaire pour une bénéficiaire de 10 ans, les mardis de 9h à 11h, " +
      "en présence de l'AESH. Éducatrice référente : Nadia Cohen. Travail sur la reconnaissance " +
      "des lettres et le graphisme ; progrès notables sur la tenue du crayon. Aucune donnée sur " +
      "la date ou le lieu de naissance n'a été transmise ce trimestre.",
  },
  {
    id: "cas-04-interactions-sociales",
    description: "Interactions sociales en IME, comportements répétitifs modérés",
    texte:
      "Suivi en IME pour un jeune de 12 ans, séances quotidiennes du lundi au vendredi de 13h30 " +
      "à 15h, éducateur référent Thomas Girard. Objectif de la période : favoriser les " +
      "interactions avec les pairs lors des temps de récréation. Comportements répétitifs " +
      "(balancement) observés environ 10 à 15 fois par séance, sans impact sur les activités. " +
      "Progression sur les jeux partagés à deux.",
  },
  {
    id: "cas-05-emotions",
    description: "Gestion des émotions, plusieurs intervenants",
    texte:
      "Bénéficiaire de 16 ans suivie à domicile et en centre de loisirs, intervenants : Julie " +
      "Rousseau (éducatrice spécialisée) et Marc Fontaine (psychomotricien), les mercredis de " +
      "10h à 12h. Travail sur la reconnaissance et la verbalisation des émotions. Un comportement " +
      "perturbateur (cris) a été observé moins d'une fois par semaine, généralement en fin de " +
      "séance. Poursuite du travail sur les outils de régulation émotionnelle (échelle des " +
      "couleurs).",
  },
  {
    id: "cas-06-sportif",
    description: "Activité sportive, aucun comportement problème",
    texte:
      "Suivi hebdomadaire le samedi matin en piscine municipale, bénéficiaire de 9 ans, " +
      "accompagné par Élodie Perrin, éducatrice sportive adaptée, et sa grand-mère présente. " +
      "Aucun comportement problème observé sur la période. Progrès sur la mise en confiance " +
      "dans l'eau et le déplacement en autonomie sur quelques mètres.",
  },
  {
    id: "cas-07-entree-minimale",
    description: "Entrée très courte, peu d'informations disponibles",
    texte:
      "Bénéficiaire de 7 ans, deux séances ce trimestre avec Paul Nguyen, éducateur. Peu " +
      "d'éléments observés cette période en raison d'absences répétées.",
  },
  {
    id: "cas-08-preprofessionnel",
    description: "Apprentissages préprofessionnels, adulte en ESAT",
    texte:
      "Suivi en ESAT pour un bénéficiaire adulte de 24 ans, les lundis et mercredis de 8h30 à " +
      "12h, encadré par Isabelle Faure, éducatrice technique spécialisée. Travail sur le " +
      "chainage des tâches de conditionnement, autonomie croissante sur les 3 premières étapes " +
      "de la séquence. Comportement destructeur (jette le matériel) observé moins d'une fois " +
      "par mois, en contexte de fatigue.",
  },
  {
    id: "cas-09-audio-transcrit",
    description: "Simule une transcription audio (formulation plus orale)",
    texte:
      "Alors cette période avec Inès, 11 ans, on a bossé surtout sur la communication, elle " +
      "utilise de plus en plus son classeur PECS pour demander des choses, ça se passe les " +
      "mardis et jeudis après-midi avec moi, Yann Petit, éducateur, et parfois son grand frère " +
      "est là aussi. Pas de comportement problème particulier à signaler ce trimestre.",
  },
  {
    id: "cas-10-autres-domaines",
    description: "Domaine hors liste standard (catégorie Autres) et don. complémentaires",
    texte:
      "Bénéficiaire de 15 ans suivi en atelier d'expression artistique, les vendredis de 14h à " +
      "16h avec Camille Roux, art-thérapeute. Cette activité ne rentre dans aucune des catégories " +
      "habituelles ; à noter aussi une hospitalisation de deux semaines en cours de trimestre " +
      "ayant réduit le nombre de séances effectives.",
  },
];
