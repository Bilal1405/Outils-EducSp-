# Installer l'application sur un téléphone

Pour un praticien indépendant : les dossiers restent sur l'appareil, il n'y a
aucun serveur à joindre pour travailler.

Il n'y a **ni boutique, ni compte développeur, ni APK à signer**. Android
installe une application web directement depuis le navigateur. C'est le même
mécanisme que celui utilisé par la plupart des applications métier internes.

## Ce dont vous avez besoin

- un téléphone Android avec Chrome (ou Edge, Samsung Internet) ;
- l'adresse de l'application, servie en **HTTPS** — Android refuse d'installer
  depuis une adresse non chiffrée. L'hébergement Render fournit HTTPS d'office ;
- une connexion, une fois, pour le premier lancement.

## Installer

1. Ouvrir dans Chrome : `https://votre-adresse/?local=1`
2. L'application propose elle-même **« Installer sur cet appareil »**.
   Sinon : menu ⋮ → **Installer l'application** (ou *Ajouter à l'écran
   d'accueil*).
3. L'icône se pose sur l'écran d'accueil. L'application s'ouvre ensuite sans
   barre d'adresse, comme n'importe quelle autre.

Le `?local=1` n'est à taper qu'une fois : le raccourci installé le porte déjà.

## Ce qui se passe au premier lancement

PostgreSQL est téléchargé — **3,8 Mo compressés** — puis la base est créée sur
l'appareil. Comptez une quinzaine à une trentaine de secondes selon le
téléphone. Cela n'arrive qu'une fois.

Ensuite, l'application s'ouvre et fonctionne **sans aucun réseau**.

## Rédiger un bilan à partir d'un compte-rendu

Deux gestes demandent un modèle de langage, qui ne tient pas dans un téléphone :
**rédiger un bilan** à partir d'un compte-rendu dicté, et **mettre au propre**
un commentaire dans un parcours guidé. Eux seuls passent par le serveur ; vos
dossiers, eux, ne quittent jamais l'appareil.

Il faut donc deux choses :

1. **une connexion**, au moment de la rédaction seulement ;
2. **une clé d'activation**, à coller une fois dans *Réglages → Rédaction
   assistée*. Sans elle, l'application le dit et tout le reste continue de
   fonctionner.

Avant l'envoi, les noms que l'application connaît — le bénéficiaire, les autres
bénéficiaires de vos dossiers, votre nom, celui de votre activité — sont
remplacés par des repères. Ils sont remis en place à l'arrivée. **La première
fois, l'application vous montre le texte exact qui va partir** : relisez-le. Un
prénom qu'elle ne connaît pas — une fratrie, un collègue, une école — n'est pas
masqué, et c'est à vous d'en décider.

Vous pouvez revoir cet aperçu à tout moment : *Réglages → Rédaction assistée →
Voir ce qui sera envoyé*.

## Pourquoi l'installer plutôt que de garder l'onglet

Ce n'est pas qu'une question de confort :

- **le navigateur cesse de pouvoir effacer vos dossiers.** Un téléphone à court
  d'espace supprime les données des sites ordinaires sans prévenir ; celles
  d'une application installée sont protégées ;
- **l'application s'ouvre sans réseau.** Dans un onglet non installé, une zone
  blanche affiche la page d'erreur du navigateur.

## La dictée vocale

Le modèle de transcription (environ 140 Mo) n'est **pas** téléchargé à
l'installation : il l'est au premier clic sur le micro, et l'écran l'annonce.
Un praticien qui écrit au clavier ne le télécharge jamais.

À faire de préférence en Wi-Fi.

## Ce qu'il faut savoir, et dire aux utilisateurs

- **Les dossiers sont sur le téléphone, et nulle part ailleurs.** Aucun serveur,
  donc aucun hébergeur — c'est ce qui dispense de la certification HDS et de
  toute question de transfert. C'est aussi ce qui rend la sauvegarde
  indispensable.
- **Un téléphone perdu emporte les dossiers.** Le chiffrement d'Android protège
  tant que l'appareil est verrouillé : un code de verrouillage n'est pas
  facultatif ici.
- **Désinstaller l'application, ou effacer les données du site dans les
  réglages du navigateur, efface les dossiers.** Il n'y a pas de copie ailleurs.

## Mettre à jour

Rien à faire. L'application vérifie à chaque lancement s'il existe une nouvelle
version et, quand c'est le cas, affiche « Nouvelle version disponible ».
« Actualiser » l'applique en une seconde.

Pourquoi ce n'est pas immédiat sans ce bouton : l'interface est servie depuis
le cache de l'appareil, pour pouvoir s'ouvrir sans réseau. Une version déployée
n'est donc active qu'au lancement suivant. On ne recharge pas de force — une
actualisation au milieu d'une saisie ferait perdre ce qui n'est pas encore
enregistré.

La base et son contenu ne sont jamais touchés par une mise à jour : les
migrations s'appliquent comme sur un serveur, les dossiers restent.

## Diagnostiquer

`https://votre-adresse/diagnostic.html` fonctionne aussi sur téléphone et sans
compte. C'est par là que commence tout incident signalé.
