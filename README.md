# Moteur de génération de bilan éducatif

Implémentation de [SPEC-moteur-bilan.md](./SPEC-moteur-bilan.md) : génération
assistée par IA (Ollama self-hosted) de bilans trimestriels PCPE à partir
d'un compte-rendu texte ou audio d'éducateur.

## Prérequis

- Node.js 20+
- PostgreSQL
- Un fournisseur LLM :
  - **Cerebras** (par défaut) : clé API gratuite sur [cloud.cerebras.ai](https://cloud.cerebras.ai), modèle `gpt-oss-120b`
  - ou [Ollama](https://ollama.com) self-hosted (`LLM_PROVIDER=ollama` dans `.env`)
- Un serveur de transcription Whisper self-hosted (optionnel, requis
  uniquement pour les bilans générés à partir d'audio) — voir ci-dessous

## Installation

```bash
npm install
cp .env.example .env   # renseigner DATABASE_URL, OLLAMA_BASE_URL, ...
npm run migrate        # applique les migrations SQL (db/migrations)
```

### Serveur de transcription Whisper (optionnel)

Nécessaire uniquement pour la dictée vocale (bouton micro). Lance
[speaches](https://speaches.ai) (API OpenAI-compatible) via Docker :

```bash
docker compose up -d whisper
```

Le serveur écoute sur `http://localhost:9000` (voir `WHISPER_BASE_URL` dans
`.env`). Le premier appel de transcription télécharge le modèle Whisper
(mis en cache dans un volume Docker) et peut donc être lent.

## Développement

```bash
npm run dev          # serveur HTTP avec rechargement à chaud
npm run typecheck
npm test              # tests unitaires (vitest, Ollama mocké)
npm run validate:corpus  # corpus de test contre un Ollama réel (voir ci-dessous)
```

## Structure

- `src/schema/bilan.schema.ts` — schéma Zod du bilan (source de vérité des enums fermées)
- `src/prompts/bilanPrompt.ts` — system prompt + template utilisateur du moteur
- `src/services/bilanGenerator.ts` — `generateBilan(inputText, previousBilan?)` : appelle le LLM, parse et valide la sortie, retry une fois si invalide
- `src/services/llmClient.ts` — abstraction fournisseur LLM (`LLM_PROVIDER=cerebras|ollama`)
- `src/services/cerebrasClient.ts` / `ollamaClient.ts` / `whisperClient.ts` — clients HTTP vers les différents services
- `src/repositories/bilanRepository.ts` — accès DB (dernier bilan validé, insertion en brouillon)
- `src/repositories/patientRepository.ts` / `utilisateurRepository.ts` — gestion des bénéficiaires/éducateurs
- `src/routes/bilans.ts` — `POST /api/patients/:id/bilans/generate`
- `src/routes/patients.ts` / `utilisateurs.ts` — `GET`/`POST /api/patients` et `/api/utilisateurs`
- `public/` — interface web statique (HTML/CSS/JS vanilla) pour déclencher une génération sans passer par l'API directement
- `db/migrations/` — schéma SQL (`patients`, `utilisateurs`, `bilans`)
- `test/fixtures/inputs.ts` — corpus de 10 comptes-rendus fictifs
- `test/validate-corpus.ts` — exécute le corpus contre un Ollama réel et logue les échecs de validation de schéma

## Endpoint

```
POST /api/patients/:id/bilans/generate
Headers: x-user-id: <auteur_id>   (placeholder en attendant l'authentification)
Body: { texte?: string, audioFileId?: string, periode_debut: string, periode_fin: string }
```

Récupère le dernier bilan validé du patient (contexte de continuité),
génère le bilan via `generateBilan()`, l'enregistre en base avec le statut
`brouillon`, et retourne le JSON généré pour validation/édition côté
éducateur avant passage en statut `validé`.

## Interface web

Une fois le serveur démarré (`npm run dev`), ouvrez `http://localhost:3000`
dans un navigateur : la page permet de sélectionner ou créer un bénéficiaire
et un éducateur, saisir un compte-rendu et une période, puis déclencher la
génération et visualiser le bilan produit (vue lisible + JSON brut).

## Déploiement (Render)

Le fichier [`render.yaml`](./render.yaml) définit un Blueprint Render :
un service web Node.js + une base PostgreSQL managée, avec déploiement
automatique à chaque push sur la branche configurée.

1. Créez un compte sur [render.com](https://render.com) (gratuit) et connectez votre compte GitHub.
2. **New → Blueprint**, sélectionnez le dépôt `Outils-EducSp-` — Render détecte `render.yaml` automatiquement.
3. Une fois les services créés, allez dans le service web → **Environment** et renseignez `CEREBRAS_API_KEY` (clé gratuite sur cloud.cerebras.ai) — c'est la seule valeur à saisir manuellement, elle n'est jamais commitée dans le repo.
4. Chaque `git push` sur la branche configurée redéploie automatiquement.

⚠️ Le service Whisper self-hosted (transcription audio, via `docker-compose.yml`) n'est **pas** provisionné sur Render — il tourne uniquement en local. Le déploiement Render fonctionne pour la génération de bilan à partir de texte (Cerebras est une API cloud, accessible depuis n'importe où), mais pas pour la dictée au micro.

## Confidentialité

Aucune donnée patient réelle n'est présente dans ce dépôt : les fixtures de
test (`test/fixtures/`) sont entièrement fictives. Voir la note de
confidentialité dans [SPEC-moteur-bilan.md](./SPEC-moteur-bilan.md).
