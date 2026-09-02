# Contexte projet

SaaS de génération de bilans éducatifs pour le secteur médico-social (PCPE,
handicap). Interface et code en français.

## Stack réelle (autorité — prime sur les documents de spec)

- Backend : Node.js 22 + **Express 4** + TypeScript (CommonJS, strict)
- DB : PostgreSQL, **SQL brut**, migrations dans `db/migrations/`. Deux moteurs
  derrière `src/db.ts` : `postgres://…` (serveur, `node-postgres`) ou
  `fichier:./donnees` (PGlite, PostgreSQL en WebAssembly, rien à installer).
  Ce n'est pas un portage — le même SQL passe sur les deux, et
  `test/baseEmbarquee.test.ts` le vérifie migration par migration. Ne jamais
  écrire de requête qui ne passe que sur l'un des deux ; `pool.executerScript()`
  pour un script à plusieurs instructions, `pool.transaction()` pour une
  transaction.
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

Ce que la dictée doit télécharger — bibliothèque, moteur WebAssembly, poids du
modèle — l'est par l'écran de préparation (`public/js/preparation.js`), juste
après la connexion, pas au premier clic sur le micro. L'attente tombait sinon
après avoir parlé, et se répétait à chaque onglet pour l'instanciation du
graphe. L'écran ne paraît qu'au-delà de 400 ms — invisible dès le deuxième
lancement — totalise les fichiers en un seul chiffre, et ne retient jamais
personne : « Continuer sans attendre » poursuit en fond, un échec propose
d'écrire au clavier. Ne pas le rendre bloquant : un poste sans accès à
huggingface.co doit rester capable de rédiger.

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

Toutes les routes passent par `creerRouteur()` (`src/routeurAsync.ts`), jamais
par `Router()` d'Express : sans cela, un rejet de promesse dans un gestionnaire
`async` ne va pas au gestionnaire d'erreur mais termine le processus — une
coupure de base faisait tomber l'application entière au lieu de rendre une
requête en erreur. `test/asynchrone.test.ts` refuse tout fichier de routes qui
s'en écarte.

Rien de ce que l'éducateur saisit ne doit tenir à la vie d'un onglet. Le
compte-rendu en cours est enregistré au serveur deux secondes après la dernière
frappe (`brouillons_saisie`, un par bénéficiaire et par rédacteur, effacé dès
qu'il a produit son bilan) ; le parcours guidé s'enregistre vingt secondes après
la dernière modification et quand l'onglet passe en arrière-plan ; `beforeunload`
retient la fermeture s'il reste quelque chose en jeu. Le stockage du navigateur
reste écarté : il déposerait des données de santé sur le disque du poste.

Journal d'audit (`audit_logs`) : lectures comprises. Effacement d'un
bénéficiaire en cascade, la trace survit à l'effacement. L'écriture ne bloque
pas la réponse (`journaliser` rend la main aussitôt) : ne pas la remettre sur
le chemin critique, et ne pas en déduire l'issue d'une action.

Le démarrage en production passe par `scripts/demarrer.ts`, pas par
`migrate && start` : cet enchaînement s'arrêtait au premier ordre quand la base
était injoignable, et l'on n'obtenait alors ni `/health` ni `/diagnostic.html`
— les deux seules pages faites pour dire ce qui ne va pas. Le script distingue
désormais **base absente** (on démarre en état dégradé, les migrations sont
reprises en fond, `/health` répond 200 avec `status: degraded`) de **migration
refusée** (on s'arrête : un schéma à moitié posé ne doit rien servir). `/health`
doit rester en 200 tant que le processus répond — l'hébergeur n'a que cette
sonde pour décider si l'instance vit, et un 503 la ferait rejeter au
déploiement, emportant le diagnostic avec elle. Une base injoignable rend 503
sur les routes, jamais « Erreur interne » ni « Session expirée ».
`test/demarrageDegrade.test.ts` borde tout cela.

`public/diagnostic.html` vérifie sur le poste tout ce dont l'application a
besoin — navigateur, micro, origine sécurisée, écran, accès à huggingface.co et
jsdelivr.net, présence de la bibliothèque côté serveur, base de données,
version — et rend un rapport copiable. Accessible **sans être connecté** : ne
pas pouvoir se connecter est l'un des incidents à diagnostiquer. Toute panne
signalée par un utilisateur commence par là.

Sauvegarde : `GET /api/etablissement/sauvegarde` (coordinateur) rend un JSON
téléchargeable de tout l'établissement, sans les empreintes de mots de passe —
un fichier de sauvegarde circule. `scripts/restaurer-sauvegarde.mjs` le
réinjecte dans une base vide, dans une transaction, et refuse une base qui
contient déjà des dossiers. L'ancien `npm run sauvegarde` reste bon en local ;
en ligne il écrivait dans le conteneur, effacé à chaque redéploiement.

Reste : transfert des comptes-rendus vers Cerebras (États-Unis) — non traité à
la demande explicite de l'utilisateur ; chiffrement de `contenu` au repos ;
Stripe ; gabarits RGPD.

Manque aussi une date de validation en base : `bilans` ne garde pas l'instant
du passage en « validé ». L'UI ne l'affiche donc pas — ne pas écrire
« validé le … » tant que la colonne n'existe pas.

## Conventions de réponse

Pas de récapitulatif de ce qui vient d'être fait, pas de conclusion. Aller au
fait.
