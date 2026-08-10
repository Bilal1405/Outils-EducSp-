# Contexte projet

SaaS de génération de bilans éducatifs pour le secteur médico-social (PCPE,
handicap). Interface et code en français.

## Stack réelle (autorité — prime sur les documents de spec)

- Backend : Node.js 22 + **Express 4** + TypeScript (CommonJS, strict)
- DB : PostgreSQL, **SQL brut** (`node-postgres`), migrations dans `db/migrations/`
- Frontend : **HTML/CSS/JS vanilla** dans `public/` — modules ES natifs dans
  `public/js/`, pas de bundler, pas de framework
- Validation : Zod. Trois trames de bilan :
  - `bilan` — `src/schema/bilan.schema.ts`, rédigée par le moteur ;
  - `repit` / `trimestriel` — décrites en données dans
    `src/schema/modelesBilan.ts`, d'où sont **dérivés** le schéma Zod
    (`modeleValidation.ts`), le formulaire guidé et l'export .docx. Ne jamais
    recopier ces listes ailleurs.
- LLM : adaptateur `src/services/llmClient.ts` (`LLM_PROVIDER=cerebras|ollama`)
- Transcription : `public/transcription.js` — Whisper dans le navigateur
  (transformers.js), aucun service serveur, aucun audio transmis ni stocké
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

Fait : schéma Zod, migrations 001–009, moteur de génération (+retry), adaptateur
LLM, transcription navigateur, reformulation de commentaires, quotas, export
.docx des trois trames, API patients/utilisateurs/bilans, `/api/schema/*`,
UI `public/` (accueil guidé, parcours guidé par étapes, relecture champ par
champ), `/health`, déploiement Render.

Les trames Répit et Trimestriel se remplissent à la main : le moteur n'y coterait
que des compétences qu'il n'a pas observées. Il n'intervient que pour remettre au
propre un commentaire dicté (`/api/assistance/reformulation`), sans rien ajouter.

Contrainte d'écran : une étape de parcours guidé doit tenir dans 1366×768 sans
défilement. Vérifiée par mesure en navigateur ; `test/modelesBilan.test.ts` borde
le nombre de lignes de grille par étape. Scinder l'étape et remesurer si dépassé.

Démarrage : l'interface ouvre par **un seul** aller-retour utile,
`GET /api/amorcage` (établissement, quota, équipe, bénéficiaires), lancé en
parallèle des deux routes de schéma — qui répondent 304 grâce à une empreinte
figée. Mesuré dans Chromium à 100 ms de latence : 556 ms à froid, contre
1342 ms quand ces appels étaient enchaînés. Ne pas réintroduire d'appel
supplémentaire dans cette séquence : les ajouter à `/api/amorcage`, ou les
différer jusqu'à l'écran qui en a besoin.

Les fichiers de `public/` passent par `src/middleware/statique.ts` : brotli ou
gzip selon le navigateur, mémorisé en RAM, `ETag` sur le contenu servi. Tout est
revalidé à chaque chargement sauf `/vendor/`, figé par sa version. 63 Kio
transférés au premier chargement au lieu de 197.

> `SPEC-moteur-bilan.md` décrit un `audioFileId` transcrit par un Whisper
> self-hosted côté serveur. Remplacé : la transcription se fait dans le
> navigateur, le corps de requête ne porte plus qu'un `texte` et un marqueur
> `source`.

Sécurité (migrations 010–012) : sessions serveur opaques (cookie httpOnly,
scrypt pour les mots de passe), rôles educateur/coordinateur/admin, garde CSRF
par en-tête, cloisonnement imposé côté serveur — l'établissement vient
**toujours** de la session, jamais de la requête. `test/securite.test.ts` borde
cette frontière : ne pas ajouter de route sans l'y couvrir.

Journal d'audit (`audit_logs`) : lectures comprises. Effacement d'un
bénéficiaire en cascade, la trace survit à l'effacement. L'écriture ne bloque
pas la réponse (`journaliser` rend la main aussitôt) : ne pas la remettre sur
le chemin critique, et ne pas en déduire l'issue d'une action.

Reste : transfert des comptes-rendus vers Cerebras (États-Unis) — non traité à
la demande explicite de l'utilisateur ; chiffrement de `contenu` au repos ;
Stripe ; gabarits RGPD.

Manque aussi une date de validation en base : `bilans` ne garde pas l'instant
du passage en « validé ». L'UI ne l'affiche donc pas — ne pas écrire
« validé le … » tant que la colonne n'existe pas.

## Conventions de réponse

Pas de récapitulatif de ce qui vient d'être fait, pas de conclusion. Aller au
fait.
