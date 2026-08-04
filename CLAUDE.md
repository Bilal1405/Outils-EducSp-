# Contexte projet

SaaS de génération de bilans éducatifs pour le secteur médico-social (PCPE,
handicap). Interface et code en français.

## Stack réelle (autorité — prime sur les documents de spec)

- Backend : Node.js 22 + **Express 4** + TypeScript (CommonJS, strict)
- DB : PostgreSQL, **SQL brut** (`node-postgres`), migrations dans `db/migrations/`
- Frontend : **HTML/CSS/JS vanilla** dans `public/` (pas de bundler)
- Validation : Zod — `src/schema/bilan.schema.ts` est la **source unique** du schéma bilan
- LLM : adaptateur `src/services/llmClient.ts` (`LLM_PROVIDER=cerebras|ollama`)
- Transcription : `src/services/whisperClient.ts` (speaches, API OpenAI-compatible)
- Tests : vitest
- Déploiement : Render (`render.yaml`), auto-deploy sur push

> `INSTRUCTIONS-claude-code.md` mentionne Fastify + Prisma + React/Vite : c'est
> la cible initiale, **abandonnée**. Ne pas migrer sans demande explicite.

## Contraintes non négociables

1. Aucune donnée patient réelle dans le dépôt, même en fixtures.
2. Le moteur n'invente jamais de donnée absente de l'entrée.
3. Jamais de valeur par défaut en cas d'échec de génération : lever une erreur.
4. Un champ vide reste visiblement vide côté UI (ne pas masquer une absence).
5. Aucun secret commité ; aucune font/icône chargée depuis un CDN externe.

## Commandes

```bash
npm run dev        # serveur + rechargement à chaud
npm run typecheck
npm test
npm run migrate
```

## État d'avancement

Fait : schéma Zod, migrations 001–008, moteur de génération (+retry), adaptateurs
LLM/Whisper, quotas, export .docx, API patients/utilisateurs/bilans, UI `public/`,
déploiement Render.

Reste : authentification réelle (`x-user-id` est un placeholder non vérifié),
cloisonnement par établissement + tests, audit_logs, chiffrement
`informations_sante`, Stripe, gabarits RGPD, durcissement déploiement.

## Conventions de réponse

Pas de récapitulatif de ce qui vient d'être fait, pas de conclusion. Aller au
fait.
