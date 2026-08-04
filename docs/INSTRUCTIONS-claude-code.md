# Instructions de build — prompts par phase

Version optimisée de `INSTRUCTIONS_claude_code.md`. Le contexte projet, la stack
et les contraintes vivent désormais dans `CLAUDE.md`, chargé automatiquement à
chaque session : **ne plus les recoller**.

**Mode d'emploi** — coller un seul bloc à la fois, valider, puis `/clear` avant
la phase suivante. Un `/clear` entre deux phases évite de traîner tout
l'historique de la précédente (poste de dépense n°1).

Les phases 0 à 2, 4 et 5 sont livrées. Elles sont conservées ici en référence
de ce qui a été demandé, mais ne doivent plus être recollées.

---

## PHASE 3 — Authentification et cloisonnement *(à faire)*

```
Intègre Keycloak.

Realm dédié, client frontend public (PKCE) + client backend confidentiel.
Rôles : educateur, admin_etablissement, admin_plateforme. MFA TOTP activable.
Mot de passe : 12 caractères minimum, complexité imposée.

Backend :
- middleware de vérification JWT sur toutes les routes sauf /health ; il
  remplace le placeholder x-user-id, qui doit disparaître ;
- middleware de cloisonnement : tout accès à un patient ou un bilan vérifie
  l'appartenance à l'établissement de l'utilisateur authentifié. Accès non
  autorisé → 404, jamais 403 (ne pas révéler l'existence de la ressource) ;
- middleware d'audit : toute lecture/écriture/suppression sur patients et
  bilans est journalisée dans audit_logs (id, user_id, action, ressource_type,
  ressource_id, ip_address, created_at) — crée la table si absente.

Tests d'intégration obligatoires : un utilisateur de l'établissement A ne peut
ni lire, ni modifier, ni supprimer une ressource de l'établissement B, sur
chaque route existante. C'est le test le plus critique du projet.
```

---

## PHASE 6 — Paiement et quota *(à faire)*

```
Intègre Stripe par-dessus le quota existant (src/services/quotaService.ts,
table quota_usage).

- Stripe Checkout pour la souscription (30 €/mois, 4 bilans inclus)
- Stripe Billing pour l'abonnement récurrent
- Table abonnements : id, etablissement_id (FK), stripe_customer_id,
  stripe_subscription_id, statut, quota_mensuel (défaut 4),
  bilans_consommes_periode, periode_reset_at
- Webhook POST /api/webhooks/stripe : souscription créée, paiement réussi,
  paiement échoué, abonnement annulé → met à jour abonnements, reset le
  compteur à chaque période. Signature du webhook vérifiée (obligatoire).
- Au-delà du quota : metered billing OU blocage strict, selon la
  configuration de l'établissement.
- Gestion de l'abonnement via Stripe Customer Portal (ne pas recoder les
  moyens de paiement). Aucune donnée de carte ne transite par le backend.
```

---

## PHASE 7 — Conformité RGPD (technique) *(à faire)*

```
Implémente :

1. Droit d'accès : GET /api/patients/:id/export → intégralité des données du
   patient en JSON lisible.
2. Droit à l'effacement : DELETE /api/patients/:id → suppression définitive du
   patient et de ses bilans (cascade), anonymisation des audit_logs le
   concernant (conserver l'action, supprimer l'identifiant).
3. Conservation : cron identifiant les patients inactifs depuis N années (N
   configurable) et alertant l'admin de l'établissement. Jamais de suppression
   automatique sans validation humaine.
4. Chiffrement : TLS + HSTS, chiffrement at-rest de la base, chiffrement
   applicatif AES-256-GCM du champ informations_sante (clé en variable
   d'environnement). Justifie le choix en commentaire.
5. audit_logs consultable par l'admin d'établissement, purge automatique à
   6 mois.
6. Minimisation : fichier audio supprimé du disque immédiatement après
   transcription ; transcription brute non conservée après génération.
7. Aucun cookie tiers, aucun tracker. Cookie de session strictement
   fonctionnel si nécessaire.

Génère aussi les gabarits, en une passe, sans commentaire de ta part :
docs/mentions-legales.md, docs/politique-confidentialite.md, docs/cgv.md,
docs/registre-traitements.md (modèle CNIL).
```

---

## PHASE 8 — Déploiement *(à faire — Render déjà en place)*

```
Le déploiement actuel est Render (render.yaml, auto-deploy sur push). Cible
finale : VPS EU (OVHcloud ou Scaleway), hébergement certifié HDS.

1. Dockerfiles de production multi-stage.
2. docker-compose.prod.yml : nginx (reverse proxy + TLS Let's Encrypt),
   postgres, keycloak, app. Whisper uniquement si l'adaptateur self-hosted est
   retenu.
3. Sauvegarde automatique : pg_dump chiffré, rotation 7 jours, volume séparé.
4. nginx : HSTS, CSP, X-Frame-Options, X-Content-Type-Options, rate limiting
   sur /api/*.
5. GitHub Actions : lint + tests à chaque push, build des images sur tag.
6. docs/DEPLOIEMENT.md : procédure pas à pas, génération des secrets, DNS.

Aucun secret dans le dépôt : tout par variables d'environnement.
```

---

## Phases livrées — référence

<details>
<summary>Phase 0 — Fondations · Phase 1 — Schéma · Phase 2 — Moteur · Phase 4 — API · Phase 5 — Interface</summary>

**Phase 0** — projet initialisé, `.env.example` commité et `.env` ignoré,
`.gitignore` strict (`.env`, `/uploads`, `*.docx`, `*.pdf`, `node_modules`),
`npm run dev`.

**Phase 1** — `src/schema/bilan.schema.ts` (source unique, enums fermées),
migrations `db/migrations/001` à `008` : patients, utilisateurs, bilans (JSONB
+ index GIN, `bilan_precedent_id`), etablissements, quota_usage. Cascade de
suppression patient → bilans. Restent à créer : `audit_logs` (phase 3),
`abonnements` (phase 6), chiffrement de `informations_sante` (phase 7).

**Phase 2** — system prompt (`src/prompts/bilanPrompt.ts`), `generateBilan()`
avec parsing, validation Zod, 1 retry correctif puis erreur explicite ;
adaptateur `llmClient` (cerebras | ollama) ; transcription `whisperClient` ;
corpus de 10 comptes-rendus fictifs (`npm run validate:corpus`).

**Phase 4** — routes patients, utilisateurs, etablissements, bilans (liste,
détail, génération, édition, validation, export .docx), quota vérifié **avant**
la génération.

**Phase 5** — `public/` : liste patients, dictée micro, période, génération avec
état de chargement, édition section par section, export .docx, compteur de
bilans restants.

</details>

---

## Arbitrages et étapes hors développement

Ces sections ne sont pas des prompts. Ne jamais les coller dans une session.

**Réserve sur le self-hosted.** Faire tourner Ollama ou Whisper sur
l'infrastructure d'un établissement médico-social est rarement réaliste :
postes sous-dimensionnés, parc infogéré, pas d'équipe technique interne. D'où
l'adaptateur. Si le fournisseur retenu est une API distante, la question du
traitement de données de santé par un tiers se repose entièrement
(pseudonymisation avant envoi, DPA, secret professionnel). Héberger Ollama sur
le serveur du projet ramène l'obligation HDS et son coût. À arbitrer avec les
établissements cibles : cela conditionne le coût d'infrastructure et la
qualification réglementaire.

**Avant mise en ligne** — trancher cas A/cas B du brief (données de santé →
hébergement certifié HDS, pas un VPS standard) ; compte Stripe + DPA signé ;
contrat d'hébergement avec clauses HDS ; AIPD (logiciel PIA de la CNIL) ;
relecture juridique des mentions légales, CGV et politique de confidentialité ;
registre des traitements (art. 30) ; assurance RC Pro / cyber.

**Mise en vente** — statut juridique + compte bancaire pro ; établissement
pilote sous convention de test ; ne pas ouvrir la vente publique avant
validation du moteur sur cas réels. Pentest fortement recommandé.

Les gabarits de la phase 7 sont un point de départ technique, pas un avis
juridique.
