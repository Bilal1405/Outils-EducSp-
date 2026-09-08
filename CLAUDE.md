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

Contrainte d'écran, version bureau : une étape de parcours guidé doit tenir dans
1366×768 sans défilement. Vérifiée par mesure en navigateur — les trente étapes des deux
trames, `scrollHeight` contre `clientHeight` — et `test/modelesBilan.test.ts`
borde le nombre de lignes de grille par étape. Scinder l'étape et remesurer si
dépassé. Deux étapes débordaient de neuf et vingt-six pixels ; la marge a été
reprise dans les interlignes du parcours et l'interligne des grilles à deux
colonnes, sans toucher au contenu des trames.

**Sur téléphone, cette règle change de forme.** En 393×851 une cotation à huit
items ne peut pas tenir : le budget vertical est de 300 à 480 px. Ce qui la
remplace, et qui doit rester vrai : le titre d'étape, la jauge et le pied restent
visibles en permanence ; seul `.parcours-corps` défile. Sous 860 px, les tableaux
deviennent une **pile de cartes** — l'item en entier, ses valeurs en boutons de
44 px sur deux colonnes — parce qu'à cette largeur les seuls en-têtes de
l'échelle de guidance réclament 420 px pour 327 disponibles, et que le
défilement horizontal du tableau empêchait de voir l'item et sa case en même
temps. Mêmes items, mêmes valeurs, mêmes données : c'est l'affichage qui change,
pas la trame, et la version bureau garde son tableau. Le rendu passe par un
`<label class="cotation-option">` qui enveloppe chaque bouton radio — il rend
aussi toute la cellule cliquable, là où seul un rond de 17 px l'était. Ne pas lui
donner de hauteur propre : mesuré, un `min-height` y coûte 47 px sur une grille
de huit items et fait défiler une étape qui tenait. `verifier-parcours-mobile`
et `verifier-hauteurs` bordent les deux côtés.

Démarrage : l'interface ouvre par **un seul** aller-retour utile,
`GET /api/amorcage` (établissement, quota, équipe, bénéficiaires), lancé en
parallèle des deux routes de schéma — qui répondent 304 grâce à une empreinte
figée. Mesuré dans Chromium à 100 ms de latence : 556 ms à froid, contre
1342 ms quand ces appels étaient enchaînés. Ne pas réintroduire d'appel
supplémentaire dans cette séquence : les ajouter à `/api/amorcage`, ou les
différer jusqu'à l'écran qui en a besoin.

Version pour praticien indépendant (`?local=1`) : pas de serveur, donc pas
d'hébergeur — ni HDS à obtenir, ni base supprimée au bout de 30 jours, ni
donnée de santé qui sorte de l'appareil. `public/js/local/` porte la base
(PGlite dans le navigateur, `public/js/local/base.js`) et un routeur qui rejoue
les routes du serveur (`routeur.js`). L'interface n'a pas changé d'une ligne :
elle ne parle qu'à `public/js/api.js`, qui dispatche selon le mode, lu dans
l'adresse et non dans un réglage mémorisé. Trois fichiers sont **générés** —
`migrations.js`, `schema.js` (et `contenuVierge.js` en transcrit le calcul) :
ne jamais les modifier à la main, `npm run generer:migrations` et
`generer:schema` les produisent, `test/migrationsNavigateur.test.ts` et
`test/routeurLocal.test.ts` refusent une copie périmée. Ce qui manque encore
répond 501 avec sa raison, jamais en silence : export .docx, sauvegarde.

Rédaction assistée sur téléphone : un modèle de langage ne tient pas dans un
appareil, et la clé du fournisseur ne peut pas y être déposée. Deux routes du
serveur — `POST /api/local/redaction` et `/api/local/reformulation`
(`src/routes/assistanceLocale.ts`) — sont donc ouvertes par **clé d'activation**
(`CLES_ACTIVATION_LOCALE`, `src/middleware/cleActivation.ts`). Elles sont montées
**au-dessus** de `app.use("/api", exigerAuthentification)` : cette ligne doit
continuer de se lire « tout ce qui suit est fermé », on ne lui ajoute pas
d'exception. Trois propriétés à ne pas défaire :

- **elles n'écrivent rien** — ni bilan, ni journal, ni compteur. Le document est
  rédigé sur l'appareil ; le serveur n'en garde pas de trace, et répond donc même
  base injoignable. `test/assistanceLocale.test.ts` compte les requêtes SQL ;
- **fermé par défaut** : sans clé configurée, 503 et l'application le dit. Un
  oubli de configuration ferme, il n'ouvre jamais ;
- **le plafond est compté par clé**, pas globalement (`identite` de
  `limiter()`), sans quoi le premier appareil viderait celui des autres.

Côté appareil, `public/js/local/masquage.js` retire avant l'envoi les noms que
la base connaît — bénéficiaire, autres bénéficiaires, auteur, activité — et les
remet au retour ; `en_tete` est ensuite **réécrit depuis la base**, jamais gardé
du modèle, qui n'a reçu aucun nom. Ce qu'il ne couvre pas est écrit dans le
module et dans `test/masquage.test.ts` : un prénom que la base ignore — fratrie,
collègue, école — passe. C'est à cela que sert l'aperçu montré avant le premier
envoi (`public/js/apercuEnvoi.js`), qui donne à lire ce qui part au lieu de
l'affirmer. Un texte pseudonymisé reste une donnée personnelle (RGPD art. 4·5) :
le masquage réduit le risque, il ne change pas la nature de ce qui circule.

Seule cette fonction demande du réseau ; tout le reste continue sans. Hors
réseau et sans clé donnent deux messages distincts, jamais un échec muet.

Le stockage du navigateur reste écarté pour les données de santé. **Trois clés**
y échappent, et aucune n'en porte : `educsp-theme`, `educsp-cle-activation`
(hors de la base, qui part dans les sauvegardes) et `educsp-apercu-vu`.
`test/theme.test.ts` refuse toute quatrième.

Mise à jour : c'est ce dont tout le reste dépend, et cela s'est payé. Chaque
construction produit une identité (`npm run generer:version` → `version.json`
et `public/js/version.js`), dont **`sw.js` est dérivé** (`generer:sw`, qui lit
`version.json` plutôt que de recalculer — deux horodatages à une seconde
d'écart et l'appareil se croit en retard sur lui-même). Le nom du cache la
porte : plus de constante à incrémenter, plus de déploiement invisible. La
liste de préchargement est relevée sur le disque, jamais écrite à la main.
`/version.json` est servi `no-store` **et** laissé passer par le service
worker : mis en cache, il affirmerait que tout va bien quel que soit le
déploiement. Deux détections indépendantes — l'événement du service worker et
la comparaison des versions — parce qu'elles échouent différemment. Un clic
suffit : `appliquerLaMiseAJour()` attend la relève du service worker avant de
recharger, sans quoi le rechargement est encore servi par l'ancien et il en
faut un second. Le recours (`repartirDeZero`, dans `/diagnostic.html`) ne
touche **jamais** IndexedDB : « effacer les données du site » effacerait les
dossiers. `test/miseAJour.test.ts` borde tout cela.

Elle s'installe sur l'écran d'accueil sans boutique ni compte développeur :
manifeste (`start_url: /?local=1`), service worker (`public/sw.js`), icônes
dessinées par `npm run generer:icones` — encodeur PNG écrit à la main, aucune
dépendance de rendu. L'installation n'est pas cosmétique : elle obtient le
stockage persistant, sans lequel un navigateur à court d'espace peut effacer
des dossiers de bénéficiaires. Le service worker ne met **jamais** `/api/` en
cache. `test/pwa.test.ts` refuse une liste de préchargement qui référencerait
un fichier absent — l'erreur ne se verrait sinon qu'en zone blanche.
`INSTALLATION-MOBILE.md` décrit la marche à suivre.

Sur téléphone, la préparation de la dictée ne se déclenche pas d'elle-même :
cent quarante mégaoctets sur une connexion mesurée ne s'engagent pas sans
qu'on les demande. Le modèle est chargé au premier usage du micro.

Ce que la dictée doit télécharger — bibliothèque, moteur WebAssembly, poids du
modèle — l'est par `public/js/preparation.js`, juste après la connexion, pas au
premier clic sur le micro. L'attente tombait sinon après avoir parlé, et se
répétait à chaque onglet pour l'instanciation du graphe. Ne jamais la rendre
bloquante : un poste sans accès à huggingface.co doit rester capable de rédiger.

Un seul écran de chargement, `public/js/chargement.js`. Il y en avait trois qui
ne se connaissaient pas — base de l'appareil, connexion, dictée — et entre eux
trois moments de page blanche : le chargement des dossiers, la vérification de
session, l'intervalle entre la fermeture du portail et l'apparition de
l'interface. Le remplacement n'est pas un quatrième écran écrit à l'avance mais
un **modèle d'étapes** : chaque sous-système déclare ce qu'il entreprend
(`suivre(id, libellé, { bloquante, immediat })`) et rend compte de son
avancement ; l'écran se dessine à partir de là et se retire seul. Quatre étapes
aujourd'hui — interface, base, dossiers, dictée. Trois règles à ne pas défaire :

- **rien sous 400 ms**, sinon un deuxième lancement produit un clignotement ;
- **sauf `immediat`**, réservé à ce qui monopolise le fil principal. Mesuré :
  la minuterie armée avant l'ouverture de PGlite ne se déclenchait qu'à 3,1 s,
  le temps que trois mégaoctets de WebAssembly se compilent — trois secondes de
  page vide. Ramené à 343 ms ;
- **jamais d'impasse** : dès qu'aucune étape bloquante n'est en cours, une
  sortie est offerte. Un échec bloquant, lui, propose une reprise et le
  diagnostic, jamais « continuer ».

L'écran se suspend pendant la connexion (`suspendre()` / `reprendre()`) : les
deux ne se superposent jamais. `test/chargement.test.ts` borde le modèle sur un
faux DOM minimal — le projet n'embarque pas de bibliothèque de DOM et n'a pas à
en ajouter une pour ça.

Apparence : jetons dans `public/style.css`, thème clair et thème sombre. Le
parti pris précédent — une seule apparence claire, pour la lisibilité d'un écran
vidéoprojeté — datait d'avant l'application installée sur un téléphone. Le thème
suit `prefers-color-scheme` ; les réglages permettent de le fixer
(`public/js/theme.js`, `localStorage`, la seule chose que ce projet y dépose —
une préférence d'apparence n'est pas une donnée de santé). La palette sombre est
écrite **deux fois**, une par chemin (media query et attribut), faute de pouvoir
faire autrement en CSS sans `light-dark()` : `test/theme.test.ts` refuse qu'elles
divergent, refuse une couleur écrite en dur hors des blocs de jetons — elle ne
basculerait pas — et refuse un jeton déclaré deux fois. Contrastes mesurés en
navigateur, AA atteint dans les deux thèmes sur l'accueil, la fiche et les
réglages. La barre d'état d'Android porte deux `theme-color`, réalignées par
JavaScript quand le thème est forcé.

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

`public/comparaison-dictee.html` mesure, sur le poste et avec la voix qui s'en
servira, ce que coûte la variante quantifiée `q8` du modèle : poids
téléchargés, temps de chargement, temps de transcription, et écart au mot entre
les deux textes. La précision reste à `undefined` dans `transcription.js` — le
choix se tranche sur des dictées réelles, pas sur des chiffres publiés, mesurés
en studio sur du français lu. La page emprunte modèle et réglages à
`transcription.js` : ne rien y recopier, sinon elle comparerait autre chose que
l'outil. Aucun audio n'en sort, `test/comparaisonDictee.test.ts` le borde.

`public/diagnostic.html` vérifie sur le poste tout ce dont l'application a
besoin — navigateur, micro, origine sécurisée, écran, accès à huggingface.co et
jsdelivr.net, présence de la bibliothèque côté serveur, base de données,
version — et rend un rapport copiable. Accessible **sans être connecté** : ne
pas pouvoir se connecter est l'un des incidents à diagnostiquer. Toute panne
signalée par un utilisateur commence par là.

Ces contrôles-là ne disent que ce qui est *joignable*. « Essai réel de
transcription », à la demande parce qu'il télécharge le modèle, est le seul qui
l'exécute — et le seul qui voie un pilote graphique capable de construire le
graphe ONNX mais pas de le faire tourner. Ce cas passait tout le rapport au
vert pendant que la dictée échouait : le repli WebGPU → WASM ne couvrait que le
chargement. Il couvre maintenant l'exécution (`executerModele`), que l'essai et
la dictée empruntent tous deux — un contrôle qui suivrait un autre chemin
signalerait des pannes que l'outil rattrape.

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
