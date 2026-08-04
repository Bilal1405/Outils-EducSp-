# Bibliothèques tierces servies par l'application

Le contenu de ce dossier est servi par l'application elle-même plutôt que
chargé depuis un CDN : du JavaScript tiers exécuté dans la page a accès à
toutes les données affichées (identité des bénéficiaires, contenu des
bilans). Une compromission du CDN suffirait à les exfiltrer. Servir le
fichier depuis notre propre origine supprime ce risque, et garantit au
passage que l'application fonctionne sans dépendre de la disponibilité d'un
tiers.

## transformers.min.js

- Origine : `@huggingface/transformers`, fichier `dist/transformers.web.min.js`
- Version : **4.2.0**
- Licence : Apache-2.0
- Utilisé par : `public/transcription.js` (transcription vocale Whisper)

Ce fichier n'est **pas commité** : minifié, il contient des identifiants longs
(`BlenderbotForConditionalGeneration` et consorts) que l'analyse de secrets de
GitHub prend pour des clés d'API. Il est téléchargé depuis le registre npm et
vérifié par empreinte SHA-256 à chaque `npm install`, via
`scripts/vendor-asr.mjs`.

Pour le réinstaller à la main :

```bash
npm run vendor:asr
```

Pour changer de version : mettre à jour `VERSION` **et** `SHA256` dans
`scripts/vendor-asr.mjs` (le script refuse d'installer un fichier dont
l'empreinte ne correspond pas), puis vérifier la dictée vocale dans un
navigateur avant de commiter.
