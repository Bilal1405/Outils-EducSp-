# Bibliothèques tierces servies par l'application

Le contenu de ce dossier est servi par l'application elle-même plutôt que
chargé depuis un CDN : du JavaScript tiers exécuté dans la page a accès à
toutes les données affichées (identité des bénéficiaires, contenu des
bilans). Une compromission du CDN suffirait à les exfiltrer. Servir le
fichier depuis notre propre origine supprime ce risque, et garantit au
passage que l'application fonctionne sans dépendre de la disponibilité d'un
tiers.

## transformers.min.js

- Origine : `@huggingface/transformers`, fichier `dist/transformers.min.js`
- Version : **4.2.0**
- Licence : Apache-2.0
- Utilisé par : `public/transcription.js` (transcription vocale Whisper)

⚠️ Prendre `dist/transformers.min.js` et **pas** `dist/transformers.web.min.js` :
ce dernier laisse des imports non résolus (`onnxruntime-web/webgpu`) destinés à
un empaqueteur, et le navigateur refuse de le charger.

### C'est `transformers.min.js.br` qui est versionné

Le fichier minifié ne peut pas l'être : l'analyse de secrets de GitHub y voit
une clé d'API Mistral, parce que ses noms de classes font trente-deux
caractères alphanumériques (`BlenderbotForConditionalGenerati…`). Le dépôt
refuse la poussée. C'est un faux positif, mais il n'est pas contournable sans
désactiver une protection qui, elle, est utile.

Il était donc téléchargé depuis npm à chaque `npm install`. Cette élégance a
coûté cher : sur un déploiement Render, le téléchargement a échoué sans bruit
— il est volontairement tolérant pour ne pas bloquer une installation hors
ligne — et l'application est partie en production avec une dictée vocale
morte, la panne n'apparaissant qu'au premier clic sur le micro, chez
l'utilisateur.

D'où la forme compressée : elle est binaire, donc hors de portée de l'analyse
de secrets ; elle pèse 131 Kio au lieu de 545 ; et c'est de toute façon celle
que le serveur envoie au navigateur. `src/middleware/statique.ts` sert le
`.br` tel quel aux navigateurs qui l'acceptent — tous, en pratique — et le
décompresse pour les autres.

Le fichier minifié reste un artefact local, ignoré par git, produit par
`scripts/vendor-asr.mjs`. L'application fonctionne avec l'une ou l'autre
forme.

Pour l'installer, changer de version, ou vérifier l'intégrité de ce qui est
dans le dépôt — le script fonctionne hors ligne si l'un des deux fichiers est
déjà là :

```bash
npm run vendor:asr
```

Pour changer de version : mettre à jour `VERSION` **et** `SHA256` dans
`scripts/vendor-asr.mjs` (le script refuse d'installer un fichier dont
l'empreinte ne correspond pas), puis vérifier la dictée vocale dans un
navigateur avant de commiter.
