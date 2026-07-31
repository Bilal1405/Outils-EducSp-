# Moteur de génération de bilan éducatif

Implémentation de [SPEC-moteur-bilan.md](./SPEC-moteur-bilan.md) : génération
assistée par IA (Ollama self-hosted) de bilans trimestriels PCPE à partir
d'un compte-rendu texte ou audio d'éducateur.

## Prérequis

- Node.js 20+
- PostgreSQL
- Un serveur [Ollama](https://ollama.com) self-hosted joignable
- Un serveur de transcription Whisper self-hosted (optionnel, requis
  uniquement pour les bilans générés à partir d'audio)

## Installation

```bash
npm install
cp .env.example .env   # renseigner DATABASE_URL, OLLAMA_BASE_URL, ...
npm run migrate        # applique les migrations SQL (db/migrations)
```

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
- `src/services/bilanGenerator.ts` — `generateBilan(inputText, previousBilan?)` : appelle Ollama, parse et valide la sortie, retry une fois si invalide
- `src/services/ollamaClient.ts` / `whisperClient.ts` — clients HTTP vers les services self-hosted
- `src/repositories/bilanRepository.ts` — accès DB (dernier bilan validé, insertion en brouillon)
- `src/routes/bilans.ts` — `POST /api/patients/:id/bilans/generate`
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

## Confidentialité

Aucune donnée patient réelle n'est présente dans ce dépôt : les fixtures de
test (`test/fixtures/`) sont entièrement fictives. Voir la note de
confidentialité dans [SPEC-moteur-bilan.md](./SPEC-moteur-bilan.md).
