# Moteur de génération de bilan éducatif

Implémentation de [SPEC-moteur-bilan.md](./SPEC-moteur-bilan.md) : génération
assistée par IA (Ollama self-hosted) de bilans trimestriels PCPE à partir
d'un compte-rendu texte ou audio d'éducateur.

## Sécurité et données personnelles

L'outil manipule des données de santé concernant des personnes en situation de
handicap, souvent mineures. Les garanties en place :

- **Authentification par session serveur.** Mots de passe hachés avec `scrypt`,
  jeton de session aléatoire dont seule l'empreinte est stockée, cookie
  `httpOnly` + `SameSite=Lax`. Les sessions sont révocables immédiatement —
  c'est pourquoi ce ne sont pas des JWT.
- **Cloisonnement imposé côté serveur.** L'établissement vient de la session ;
  aucune route ne le laisse choisir par l'appelant. Une ressource d'un autre
  établissement répond 404, jamais 403 : un 403 confirmerait son existence.
- **Trois rôles.** Éducateur (son établissement), coordinateur (+ suivi,
  journal, gestion des comptes, effacement), administrateur (+ création
  d'administrateurs).
- **Protection CSRF** par en-tête personnalisé exigé sur toute écriture, en
  plus du `SameSite`.
- **Journal d'audit**, lectures comprises : c'est l'accès non légitime à un
  dossier que cherche un audit, et il ne laisse aucune autre trace.
- **Droit à l'effacement** : suppression d'un bénéficiaire et de ses bilans en
  cascade, réservée au coordinateur, confirmée par saisie du nom. L'entrée de
  journal survit à la suppression — elle ne contient plus de donnée de santé,
  seulement la preuve que l'effacement a eu lieu.
- **Plafonds** sur les routes qui appellent le moteur (20 générations et
  100 reformulations par heure et par compte), en plus du quota mensuel.
- **En-têtes** `Content-Security-Policy`, `X-Frame-Options`, `nosniff`.

`test/securite.test.ts` vérifie cette frontière : refus sans session sur toutes
les routes, refus CSRF, portée par établissement, rôles. Toute route ajoutée
doit y être couverte.

Ce qui n'est **pas** traité : les comptes-rendus envoyés au moteur de rédaction
partent chez le fournisseur configuré (Cerebras, États-Unis, par défaut). Pour
une structure soumise au RGPD sur des données de santé, basculer
`LLM_PROVIDER=ollama` sur une instance auto-hébergée ferme ce sujet ;
l'adaptateur est déjà en place.

## Sauvegardes

```bash
npm run sauvegarde                     # sauvegarde horodatée dans sauvegardes/
node scripts/sauvegarde.mjs --lister
RESTAURER_VERS=postgres://…/base_test node scripts/sauvegarde.mjs --restaurer <fichier>
```

La restauration exige `RESTAURER_VERS` : elle écrase des données, elle ne doit
pas pouvoir partir sur la base courante par inadvertance. Les fichiers produits
contiennent l'intégralité des données de santé — à chiffrer et à conserver hors
du serveur. Le dossier est ignoré par git.

## Prérequis

- Node.js 20+
- PostgreSQL
- Un fournisseur LLM :
  - **Cerebras** (par défaut) : clé API gratuite sur [cloud.cerebras.ai](https://cloud.cerebras.ai), modèle `gpt-oss-120b`
  - ou [Ollama](https://ollama.com) self-hosted (`LLM_PROVIDER=ollama` dans `.env`)

La dictée vocale ne demande aucun prérequis : ni Docker, ni service de
transcription (voir ci-dessous).

## Démarrage en un clic (Windows)

Double-cliquez sur **`Lancer-l-application.cmd`**.

Au premier lancement, le script demande le mot de passe PostgreSQL et la clé
API Cerebras, écrit le fichier `.env`, installe les dépendances, applique les
migrations, démarre le serveur et ouvre le navigateur. Les fois suivantes, il
ne redemande rien.

Gardez la fenêtre ouverte pendant l'utilisation : la fermer arrête
l'application.

## Installation manuelle

```bash
npm install
cp .env.example .env   # renseigner DATABASE_URL et CEREBRAS_API_KEY
npm run migrate        # applique les migrations SQL (db/migrations)
npm run dev
```

`LLM_PROVIDER` n'accepte que `cerebras` ou `ollama`. Toute autre valeur
interrompt le démarrage avec un message explicite : cette variable décide si
les comptes-rendus sortent ou non de l'infrastructure, une faute de frappe ne
doit jamais la trancher à votre place.

## Transcription vocale

La dictée est transcrite **dans le navigateur** par Whisper
([transformers.js](https://huggingface.co/docs/transformers.js), ONNX
Runtime). Il n'y a rien à installer, ni conteneur ni démon.

Conséquences :

- l'audio ne quitte jamais le poste de l'éducateur et n'est jamais écrit sur
  disque — la minimisation RGPD est structurelle, pas une suppression après
  coup ;
- la bibliothèque JavaScript est servie par notre propre origine
  (`public/vendor/`), et non depuis un CDN ; elle est téléchargée depuis le
  registre npm et vérifiée par empreinte à chaque `npm install`
  (`npm run vendor:asr` pour la réinstaller) ;
- au premier usage, le navigateur télécharge le moteur d'inférence
  WebAssembly (jsDelivr, version figée) puis les poids du modèle (~150 Mo,
  `onnx-community/whisper-base`, depuis Hugging Face), et les met en cache.
  Aucune donnée patient n'est transmise lors de ces téléchargements, mais ils
  supposent un accès réseau.

Sur un navigateur qui expose WebGPU (Chrome, Edge), la transcription est
plusieurs fois plus rapide ; sinon elle s'exécute en WebAssembly sur le
processeur.

### Quand le modèle est-il préparé

Une dictée coûte deux choses : le téléchargement des poids — une seule fois par
poste, ensuite servi par le cache du navigateur — et l'instanciation du graphe
ONNX, quelques secondes à chaque onglet. Les subir après le clic sur
« Arrêter », au moment précis où l'on attend son texte, n'apporte rien. La
préparation est donc avancée, à trois moments :

- **au survol ou à la mise au clavier du bouton micro** — viser et cliquer
  prend déjà une partie de l'attente ;
- **au démarrage de l'enregistrement**, pendant que la personne parle : sur une
  dictée d'une minute, le modèle est prêt bien avant l'arrêt ;
- **à l'ouverture d'un écran de rédaction**, en temps mort, *uniquement si le
  modèle a déjà été chargé sur ce poste* — il est alors dans le cache et le
  remettre en mémoire ne consomme aucun réseau.

Un téléchargement réel est toujours annoncé, avec son avancement : engager
plusieurs dizaines de mégaoctets en silence n'est pas acceptable. Rien n'est
préchargé automatiquement tant que le premier chargement n'a pas abouti, ni
lorsque le navigateur signale un mode économie de données.

### Régler la taille du modèle

Deux constantes en tête de `public/transcription.js` :

- `MODELE` — `whisper-tiny` télécharge et démarre nettement plus vite,
  `whisper-small` transcrit mieux mais devient lourd sans WebGPU ;
- `PRECISION` — `"q8"` divise le téléchargement par trois environ et accélère
  l'instanciation, au prix d'une transcription un peu moins fidèle.

Le second est un arbitrage sur la qualité du compte-rendu, pas un réglage
technique : à vérifier sur de vraies dictées avant de l'adopter.

### Fonctionnement 100 % hors ligne (optionnel)

Pour supprimer tout appel sortant — poste sans accès Internet, ou refus de
dépendre de tiers — deux ressources sont à héberger localement dans
`public/transcription.js` :

- **le moteur WebAssembly** : copier `ort-wasm-simd-threaded*.{wasm,mjs}` du
  paquet `onnxruntime-web` dans `public/vendor/ort/`, puis fixer
  `env.backends.onnx.wasm.wasmPaths = "/vendor/ort/"` ;
- **les poids du modèle** : télécharger le dépôt du modèle dans
  `public/vendor/models/`, puis passer `env.allowLocalModels = true` et
  `env.localModelPath = "/vendor/models/"`.

Comptez une soixantaine de mégaoctets pour le moteur, selon les variantes
retenues (WebGPU et WebAssembly n'utilisent pas les mêmes fichiers).

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
- `src/services/cerebrasClient.ts` / `ollamaClient.ts` — clients HTTP vers les fournisseurs LLM
- `src/routes/schema.ts` — publie les listes fermées du schéma pour l'interface
- `public/transcription.js` — transcription vocale Whisper exécutée dans le navigateur
- `public/js/` — interface découpée en modules ES natifs (aucun empaqueteur) :
  `api` (accès HTTP), `etat` (état + bus d'événements), `ui` (briques
  communes), `reglages` (établissement/éducateur/quota), `beneficiaires`,
  `redaction` (période, dictée, génération), `bilan` (relecture et
  correction), `app` (assemblage)
- `src/repositories/bilanRepository.ts` — accès DB (dernier bilan validé, insertion en brouillon)
- `src/repositories/patientRepository.ts` / `utilisateurRepository.ts` — gestion des bénéficiaires/éducateurs
- `src/routes/bilans.ts` — `POST /api/patients/:id/bilans/generate`
- `src/routes/patients.ts` / `utilisateurs.ts` — `GET`/`POST /api/patients` et `/api/utilisateurs`
- `public/` — interface web statique (HTML/CSS/JS vanilla) pour déclencher une génération sans passer par l'API directement
- `db/migrations/` — schéma SQL (`patients`, `utilisateurs`, `bilans`)
- `test/fixtures/inputs.ts` — corpus de 10 comptes-rendus fictifs
- `test/validate-corpus.ts` — exécute le corpus contre un Ollama réel et logue les échecs de validation de schéma

## Endpoints

```
POST /api/patients/:id/bilans/generate
Headers: x-user-id: <auteur_id>   (placeholder en attendant l'authentification)
Body: { texte: string, source?: "texte" | "audio", periode_debut: string, periode_fin: string }
```

```
POST /api/patients/:id/bilans
Headers: x-user-id: <auteur_id>
Body: { type: "repit" | "trimestriel", periode_debut: string, periode_fin: string }
```

Ouvre un bilan à trame fixe. Aucun appel au moteur : le brouillon est créé avec
toutes ses clés, vides, et se remplit dans le parcours guidé.

```
GET /api/schema/bilan
→ { domaines_competence, types_comportement, frequences_comportement }

GET /api/schema/modeles
→ { types, modeles: { repit, trimestriel } }

POST /api/assistance/reformulation
Body: { texte: string, intitule?: string }
→ { texte: string }
```

L'écran de relecture propose ces valeurs en listes déroulantes plutôt qu'en
saisie libre : l'éducateur ne peut pas produire un bilan que la validation
serveur rejettera. Les recopier côté `public/` en ferait une seconde
définition, vouée à diverger de `src/schema/bilan.schema.ts`.

`source` sert uniquement de traçabilité : la dictée étant transcrite côté
navigateur, le serveur ne reçoit que du texte.

Récupère le dernier bilan validé du patient (contexte de continuité),
génère le bilan via `generateBilan()`, l'enregistre en base avec le statut
`brouillon`, et retourne le JSON généré pour validation/édition côté
éducateur avant passage en statut `validé`.

## Interface web

Une fois le serveur démarré (`npm run dev`), ouvrez `http://localhost:3000`.

### Trois trames de bilan

| Trame | Comment elle se remplit |
| --- | --- |
| **Bilan** | Compte-rendu libre, dicté ou tapé, rédigé par le moteur puis relu champ par champ. |
| **Bilan de fin de séjour en répit** | Parcours guidé de 18 étapes reprenant le document existant. |
| **Bilan trimestriel** | Parcours guidé de 12 étapes reprenant le document existant. |

Les deux trames fixes sont des **grilles d'évaluation** : elles se cochent à la
main. Les faire déduire par un modèle reviendrait à lui faire coter des
compétences qu'il n'a pas observées. Le moteur n'y intervient qu'à un endroit,
sur demande — remettre au propre un commentaire dicté, sans rien y ajouter ; le
texte d'origine reste restaurable d'un clic.

Chaque étape tient dans une hauteur d'écran, sans défilement : c'est ce qui
dicte le découpage, pas la structure du document d'origine. Le travail est
enregistré à chaque changement d'étape, et se reprend là où il s'était arrêté.

La trame est décrite **une seule fois**, dans `src/schema/modelesBilan.ts`, et
sert à la fois à valider le contenu enregistré, à construire le formulaire et à
produire l'export Word. Une ligne ajoutée à une grille apparaît donc dans les
trois, ou dans aucun.

### Le parcours

Il suit le travail réel d'un éducateur — choisir une personne, raconter la
période, relire, exporter :

1. **Mise en route.** Au premier lancement, l'écran d'accueil liste les trois
   éléments à définir (établissement, éducateur, premier bénéficiaire) et les
   coche au fur et à mesure. Le tiroir de réglages s'ouvre de lui-même sur
   l'étape qui bloque.
2. **Colonne de gauche.** Uniquement les bénéficiaires de l'établissement
   courant, avec recherche insensible aux accents (`/` place le curseur).
   Établissement, éducateur et quota vivent en tête de page et dans le tiroir
   de réglages, hors du flux de travail.
3. **Rédiger.** Raccourcis de période (trimestre en cours, trimestre
   précédent, année scolaire), zone de saisie unique, dictée au micro,
   `Ctrl`/`⌘ + Entrée` pour lancer. Un compte-rendu commencé est conservé en
   mémoire si vous changez de bénéficiaire — jamais sur disque : un
   compte-rendu ne doit pas se retrouver dans le stockage du navigateur.
4. **Relire.** Le bilan s'affiche section par section, chaque champ
   modifiable. Les valeurs contraintes sont proposées en listes déroulantes
   issues de `/api/schema/bilan` : impossible de saisir une valeur que le
   serveur rejettera. Un champ vide reste visiblement vide, une section vide
   le dit explicitement. Le JSON brut reste consultable en bas de page.
5. **Valider.** Confirmation explicite, puis passage en lecture seule et
   archivage définitif. L'export `.docx` reste disponible ; si des
   modifications sont en attente, elles sont enregistrées avant l'export pour
   que le fichier corresponde à l'écran.

Le quota mensuel est affiché en permanence, avec une jauge qui change de
couleur avant l'épuisement — le découvrir au moment du refus serait tardif.

En écran étroit, la colonne des bénéficiaires devient un tiroir. L'interface
s'affiche en clair uniquement : l'outil s'utilise en journée, souvent à
plusieurs devant le même écran.

## Accéder depuis un autre ordinateur

Trois manières, très inégales.

### 1. Déploiement Render — la seule adaptée à un usage réel

Donne une adresse publique **en HTTPS**, accessible de n'importe où. Le
certificat est émis et renouvelé par l'hébergeur : il n'y a rien à installer,
ni à payer, ni à surveiller.

Deux protections s'y ajoutent côté application, actives dès que
`NODE_ENV=production` :

- toute requête arrivée en clair est renvoyée vers son équivalent chiffré,
  avant d'atteindre la moindre route ;
- l'en-tête `Strict-Transport-Security` demande au navigateur de refuser
  lui-même le HTTP sur ce domaine pendant un an. C'est ce qui ferme la fenêtre
  du tout premier appel, le seul que la redirection ne protège pas.

Pour une adresse à vos couleurs (`bilans.votre-structure.fr`), ajoutez le
domaine dans Render → Settings → Custom Domain et créez l'enregistrement DNS
indiqué : le certificat est émis automatiquement, sans étape supplémentaire.

### 2. Réseau local — pour essayer à deux postes

L'application écoute déjà sur toutes les interfaces : au démarrage, elle
affiche les adresses par lesquelles la joindre (`http://192.168.…:3000`).
Transmettez-en une à un collègue du même réseau. Le pare-feu Windows demandera
d'autoriser Node.js — acceptez pour les **réseaux privés** seulement.

Deux limites, qui ne sont pas contournables par du code :

- **la dictée vocale ne fonctionnera pas.** Les navigateurs réservent l'accès
  au micro aux origines sécurisées : HTTPS, ou `localhost`. Une adresse IP en
  HTTP n'en fait pas partie. La règle est côté navigateur, pas côté
  application ;
- **tout circule en clair** : mots de passe, cookie de session, contenu des
  bilans. Sur un réseau d'établissement c'est déjà discutable ; sur du Wi-Fi
  partagé, non.

À réserver à une démonstration avec des données fictives.

### 3. Tunnel temporaire — pour montrer l'outil à distance

Un tunnel (Cloudflare Tunnel, ngrok) publie votre poste sur une adresse HTTPS
publique : la dictée refonctionne, et le lien s'ouvre de n'importe où. Mais
tout le trafic — donc les données de santé — traverse l'infrastructure du
fournisseur de tunnel. À n'utiliser qu'avec des données fictives, et à couper
après la démonstration.

## Déploiement (Render)

Le fichier [`render.yaml`](./render.yaml) définit un Blueprint Render :
un service web Node.js + une base PostgreSQL managée, avec déploiement
automatique à chaque push sur la branche configurée.

1. Créez un compte sur [render.com](https://render.com) (gratuit) et connectez votre compte GitHub.
2. **New → Blueprint**, sélectionnez le dépôt `Outils-EducSp-` — Render détecte `render.yaml` automatiquement.
3. Une fois les services créés, allez dans le service web → **Environment** et renseignez `CEREBRAS_API_KEY` (clé gratuite sur cloud.cerebras.ai) — c'est la seule valeur à saisir manuellement, elle n'est jamais commitée dans le repo.
4. Ouvrez l'adresse fournie par Render : le premier écran propose la **mise en
   service** (établissement + premier administrateur). Elle n'est accessible
   que tant qu'aucun compte n'existe — faites-la immédiatement, avant de
   communiquer l'adresse.
5. Chaque `git push` sur la branche configurée redéploie automatiquement.

`NODE_ENV=production` est posé par le Blueprint : il conditionne l'attribut
`secure` du cookie de session. Ne le retirez pas.

Limites du plan gratuit, à connaître avant de mettre de vraies données : le
service s'endort après quinze minutes sans trafic (première visite lente), et
la base gratuite **n'est pas sauvegardée** et expire au bout de trente jours.
Pour un usage réel, passez la base en plan payant et planifiez
`npm run sauvegarde`.

La dictée vocale fonctionne aussi sur le déploiement hébergé, puisqu'elle
s'exécute dans le navigateur de l'utilisateur et ne demande aucun service
côté serveur.

## Confidentialité

Aucune donnée patient réelle n'est présente dans ce dépôt : les fixtures de
test (`test/fixtures/`) sont entièrement fictives. Voir la note de
confidentialité dans [SPEC-moteur-bilan.md](./SPEC-moteur-bilan.md).
