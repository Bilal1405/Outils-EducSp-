# Spécification — Moteur de génération de bilan éducatif

## Contexte
Outil de génération assistée par IA (Ollama self-hosted) de bilans trimestriels
pour bénéficiaires suivis en PCPE (Pôle de Compétences et de Prestations
Externalisées — secteur handicap/autisme). Le moteur doit produire un bilan
structuré à partir d'une entrée texte ou audio (compte-rendu de l'éducateur),
en respectant fidèlement la trame ci-dessous, déduite de bilans réels du
secteur.

## Structure cible du bilan (schéma JSON à forcer en sortie du LLM)

```json
{
  "en_tete": {
    "structure": "string (nom structure/PCPE)",
    "periode_debut": "date",
    "periode_fin": "date",
    "beneficiaire_nom": "string",
    "beneficiaire_age": "number",
    "beneficiaire_date_naissance": "date (optionnel, absent dans certains bilans)",
    "beneficiaire_lieu_naissance": "string (optionnel)",
    "professionnels_intervenants": ["string (nom + fonction)"],
    "jours_heures_intervention": "string",
    "lieux": "string",
    "personnes_presentes": "string",
    "date_debut_intervention": "date"
  },
  "objectifs_intervention_periode": [
    {
      "domaine_competence": "enum[Autonomie vie quotidienne, Prévention et traitement des comportements problèmes, Émotions et comportements, Communication, Apprentissages scolaires/préprofessionnels, Interactions sociales, Activités sportives, Autres]",
      "objectif": "string"
    }
  ],
  "evaluation_comportement": [
    {
      "type_comportement": "enum[Hétéro-agressivité, Auto-agressivité, Destructeur, Perturbateur, Répétitif, Autres]",
      "frequence": "enum[Moins d'une fois par mois, Moins d'une fois par semaine, 1 à 10 fois par séance, 10 à 20 fois par séance, Plus de 20 fois par séance, Non observé]"
    }
  ],
  "donnees_complementaires": "string libre (optionnel)",
  "evaluation_objectifs_par_domaine": [
    {
      "domaine_competence": "enum (même liste que ci-dessus)",
      "observations": "string (paragraphe narratif rédigé par le moteur à partir de l'entrée éducateur)"
    }
  ],
  "autres_observations": ["string (un ou plusieurs paragraphes libres)"],
  "proposition_objectifs_periode_suivante": [
    {
      "domaine_competence": "enum (même liste)",
      "objectif": "string",
      "comment": "string (moyens/méthode envisagés)"
    }
  ]
}
```

## Règles de génération (contraintes moteur)

1. **Aucune invention de donnée** : le moteur ne doit générer que ce qui est
   déductible de l'entrée fournie (texte ou transcription audio). Si une
   section n'a pas d'information correspondante en entrée, la laisser vide
   plutôt que d'halluciner.
2. **Continuité inter-bilans** : si un patient a des bilans précédents en
   base, injecter dans le prompt le contenu de `evaluation_objectifs_par_domaine`
   et `proposition_objectifs_periode_suivante` du bilan N-1 comme contexte,
   pour assurer la cohérence du suivi (objectifs proposés à N-1 → doivent
   apparaître comme évalués à N).
3. **Registre rédactionnel** : ton professionnel, factuel, à la 3e personne,
   vocabulaire du secteur médico-social (guidance, autonomie, chainage,
   comportement problème, etc.).
4. **Sortie strictement JSON**, aucun texte hors du schéma — le backend
   parse directement la réponse.
5. **Validation post-génération** : vérifier que chaque `domaine_competence`
   utilisé appartient bien à l'enum fixe ci-dessus (rejet + retry sinon).

## Tâches pour Claude Code

### 1. Schéma DB (PostgreSQL)
```
Crée une table `bilans` avec une colonne JSONB `contenu` respectant le schéma
ci-dessus, plus : id, patient_id (FK), auteur_id (FK), date_generation,
periode_debut, periode_fin, source ('texte'|'audio'), statut
('brouillon'|'validé'). Ajoute un index GIN sur `contenu` pour permettre
la recherche future dans le contenu structuré.
```

### 2. Prompt engineering (moteur Ollama)
```
Écris le system prompt et le prompt template pour le moteur de génération de
bilan. Le system prompt doit :
- forcer une sortie JSON strict conforme au schéma du fichier
  SPEC-moteur-bilan.md fourni en contexte
- inclure les règles de génération listées (pas d'invention, registre
  professionnel, enums fermées)
- accepter en entrée : (a) le texte libre de l'éducateur, (b) optionnellement
  le JSON du bilan précédent du même patient pour contexte de suivi
Implémente une fonction generateBilan(inputText, previousBilan?) qui appelle
Ollama, parse la réponse JSON, et retry une fois en cas de JSON invalide ou
d'enum hors liste.
```

### 3. Corpus de test / validation
```
Crée un script de test qui prend 5-10 exemples d'entrées texte type
(fictives, pas de vraies données patient) et vérifie que la sortie du
moteur respecte strictement le schéma JSON (validation avec un schéma
zod/ajv). Log les échecs de validation pour ajustement du prompt.
```

### 4. Endpoint API
```
POST /api/patients/:id/bilans/generate
Body : { texte?: string, audioFileId?: string, periode_debut, periode_fin }
- Si audioFileId fourni, transcrire d'abord via Whisper self-hosted
- Récupérer le dernier bilan validé du patient (si existant) pour contexte
- Appeler generateBilan()
- Enregistrer en DB avec statut 'brouillon'
- Retourner le JSON généré pour validation/édition côté éducateur avant
  passage en statut 'validé'
```

## Note de confidentialité
Les exemples réels ayant servi à déduire cette structure contenaient des
données de santé de bénéficiaires (mineurs et adultes en situation de
handicap). Aucune donnée patient réelle n'a été reprise dans ce document —
uniquement la structure des champs. Ne pas committer de vrais bilans dans le
repo git, même en fixtures de test ; utiliser exclusivement des données
fictives pour les tests et démos.

Structure validée par recoupement sur 4 bilans trimestriels réels distincts
(4 bénéficiaires différents, périodes différentes, 2023-2024) : les sections,
l'ordre, et les libellés des 7 domaines de compétence sont identiques d'un
bilan à l'autre — seul le champ identité (nom, âge, parfois date/lieu de
naissance) et le contenu narratif varient. Ceci confirme que le schéma JSON
ci-dessus est fiable comme cible de génération, indépendamment du
bénéficiaire.
