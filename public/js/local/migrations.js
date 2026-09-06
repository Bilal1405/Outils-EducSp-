/**
 * Migrations du projet, pour la base locale du navigateur.
 *
 * FICHIER GÉNÉRÉ — ne pas modifier à la main.
 * Source : db/migrations/. Régénérer avec : npm run generer:migrations
 *
 * C'est le même SQL que celui appliqué au serveur PostgreSQL : les deux
 * moteurs partagent leurs migrations, jamais une version adaptée.
 */

export const MIGRATIONS = [
  {
    nom: "001_create_patients_table.sql",
    sql: `-- Table minimale des bénéficiaires, prérequis à la FK patient_id de \`bilans\`.
-- Étendue par le reste de l'application au fil de l'eau.
-- \`gen_random_uuid()\` est natif depuis PostgreSQL 13 : l'extension pgcrypto
-- n'est plus nécessaire, et l'exiger empêchait la base embarquée (PGlite) de
-- passer cette migration — sur une installation existante, l'extension déjà
-- créée reste sans effet.

CREATE TABLE IF NOT EXISTS patients (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    nom TEXT NOT NULL,
    prenom TEXT NOT NULL,
    date_naissance DATE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
`,
  },
  {
    nom: "002_create_utilisateurs_table.sql",
    sql: `-- Table minimale des professionnels/éducateurs, prérequis à la FK auteur_id de \`bilans\`.
-- Étendue par le reste de l'application au fil de l'eau.
CREATE TABLE IF NOT EXISTS utilisateurs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    nom TEXT NOT NULL,
    prenom TEXT NOT NULL,
    email TEXT NOT NULL UNIQUE,
    role TEXT NOT NULL DEFAULT 'educateur',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
`,
  },
  {
    nom: "003_create_bilans_table.sql",
    sql: `-- Bilans éducatifs trimestriels générés par le moteur IA.
-- \`contenu\` stocke le JSON structuré défini dans SPEC-moteur-bilan.md.
CREATE TABLE IF NOT EXISTS bilans (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    patient_id UUID NOT NULL REFERENCES patients (id),
    auteur_id UUID NOT NULL REFERENCES utilisateurs (id),
    date_generation TIMESTAMPTZ NOT NULL DEFAULT now(),
    periode_debut DATE NOT NULL,
    periode_fin DATE NOT NULL,
    source TEXT NOT NULL CHECK (source IN ('texte', 'audio')),
    statut TEXT NOT NULL DEFAULT 'brouillon' CHECK (statut IN ('brouillon', 'validé')),
    contenu JSONB NOT NULL,
    CHECK (periode_fin >= periode_debut)
);

CREATE INDEX IF NOT EXISTS idx_bilans_patient_id ON bilans (patient_id);
CREATE INDEX IF NOT EXISTS idx_bilans_patient_statut_periode
    ON bilans (patient_id, statut, periode_fin DESC);

-- Index GIN pour permettre la recherche future dans le contenu structuré
-- (ex: retrouver tous les bilans mentionnant un domaine de compétence donné).
CREATE INDEX IF NOT EXISTS idx_bilans_contenu_gin ON bilans USING GIN (contenu);
`,
  },
  {
    nom: "004_create_etablissements_table.sql",
    sql: `-- Établissements (cloisonnement des données, BRIEF_PROJET §8/§3 G-cloisonnement).
-- Auth réelle (Keycloak) et facturation (Stripe) sont À ARBITRER (hors
-- périmètre) : cette table ne porte que la structure nécessaire pour les
-- brancher plus tard sans réécrire le cœur (patients/bilans y sont
-- rattachés dès cette migration, cf 005/006).
CREATE TABLE IF NOT EXISTS etablissements (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    nom TEXT NOT NULL,
    quota_mensuel_bilans INT NOT NULL DEFAULT 50,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Établissement de secours pour les données déjà en base créées avant la
-- mise en place du cloisonnement (aucune notion d'établissement n'existait
-- avant cette migration) — cf backfill dans 005/006.
INSERT INTO etablissements (id, nom)
VALUES ('00000000-0000-0000-0000-000000000001', 'Établissement par défaut')
ON CONFLICT (id) DO NOTHING;
`,
  },
  {
    nom: "005_add_etablissement_to_patients.sql",
    sql: `-- Cloisonnement patients par établissement (BRIEF_PROJET §8).
ALTER TABLE patients
    ADD COLUMN IF NOT EXISTS etablissement_id UUID REFERENCES etablissements (id);

UPDATE patients SET etablissement_id = '00000000-0000-0000-0000-000000000001'
    WHERE etablissement_id IS NULL;

ALTER TABLE patients
    ALTER COLUMN etablissement_id SET NOT NULL;

CREATE INDEX IF NOT EXISTS idx_patients_etablissement_id ON patients (etablissement_id);
`,
  },
  {
    nom: "006_add_etablissement_to_bilans.sql",
    sql: `-- Cloisonnement bilans par établissement (BRIEF_PROJET §8). Dénormalisé
-- depuis patients.etablissement_id plutôt que déduit par jointure à chaque
-- requête, pour permettre un filtrage direct (index dédié).
ALTER TABLE bilans
    ADD COLUMN IF NOT EXISTS etablissement_id UUID REFERENCES etablissements (id);

UPDATE bilans b SET etablissement_id = p.etablissement_id
    FROM patients p
    WHERE p.id = b.patient_id AND b.etablissement_id IS NULL;

ALTER TABLE bilans
    ALTER COLUMN etablissement_id SET NOT NULL;

CREATE INDEX IF NOT EXISTS idx_bilans_etablissement_id ON bilans (etablissement_id);
`,
  },
  {
    nom: "007_add_bilan_precedent_id.sql",
    sql: `-- Traçabilité G3 : référence explicite au bilan précédent utilisé comme
-- contexte de génération (BIL-03), le cas échéant.
ALTER TABLE bilans
    ADD COLUMN IF NOT EXISTS bilan_precedent_id UUID REFERENCES bilans (id);
`,
  },
  {
    nom: "008_create_quota_usage_table.sql",
    sql: `-- Compteur de quota mensuel de génération de bilans par établissement
-- (QUOTA-01). Facturation réelle (Stripe) À ARBITRER, hors périmètre :
-- ce compteur est structuré pour être branché à un mécanisme de
-- facturation ultérieur sans réécriture (un établissement, un mois, un
-- compteur — la logique de plafond/tarification vient se greffer dessus).
CREATE TABLE IF NOT EXISTS quota_usage (
    etablissement_id UUID NOT NULL REFERENCES etablissements (id),
    mois DATE NOT NULL, -- toujours normalisé au 1er jour du mois
    bilans_generes INT NOT NULL DEFAULT 0,
    PRIMARY KEY (etablissement_id, mois)
);
`,
  },
  {
    nom: "009_add_type_bilan.sql",
    sql: `-- Trois trames de bilan coexistent désormais :
--   'bilan'       — état des lieux des compétences, rédigé par le moteur à
--                   partir d'un compte-rendu dicté ou saisi ;
--   'repit'       — bilan individuel de fin de séjour en répit, saisi par
--                   l'éducateur dans un parcours guidé ;
--   'trimestriel' — bilan trimestriel PCPE, même parcours guidé.
--
-- Les bilans déjà enregistrés suivent la structure historique : ils prennent
-- 'bilan', qui est exactement celle-là. Aucune reprise de données n'est
-- nécessaire et aucun bilan existant ne devient illisible.
--
-- La contrainte est posée en CHECK plutôt qu'en type ENUM : ajouter une trame
-- ne demandera qu'un ALTER de la contrainte, sans migration de type.
ALTER TABLE bilans
    ADD COLUMN IF NOT EXISTS type_bilan TEXT NOT NULL DEFAULT 'bilan';

ALTER TABLE bilans
    DROP CONSTRAINT IF EXISTS bilans_type_bilan_check;

ALTER TABLE bilans
    ADD CONSTRAINT bilans_type_bilan_check
    CHECK (type_bilan IN ('bilan', 'repit', 'trimestriel'));

-- L'historique d'un bénéficiaire se lit par type : un éducateur cherche « le
-- dernier trimestriel », pas « le dernier bilan ».
CREATE INDEX IF NOT EXISTS idx_bilans_patient_type
    ON bilans (patient_id, type_bilan, periode_fin DESC);
`,
  },
  {
    nom: "010_authentification.sql",
    sql: `-- Authentification réelle et cloisonnement.
--
-- Jusqu'ici l'identité de l'auteur venait d'un en-tête \`x-user-id\` que le
-- navigateur choisissait lui-même, et l'établissement d'un paramètre d'URL :
-- n'importe quel appelant pouvait lire et modifier les bilans de n'importe
-- quelle structure. Ces deux informations deviennent des propriétés de la
-- session, établies par le serveur.

-- --- Utilisateurs ----------------------------------------------------------

ALTER TABLE utilisateurs
    ADD COLUMN IF NOT EXISTS mot_de_passe_hash TEXT,
    ADD COLUMN IF NOT EXISTS etablissement_id UUID REFERENCES etablissements (id),
    ADD COLUMN IF NOT EXISTS actif BOOLEAN NOT NULL DEFAULT TRUE,
    ADD COLUMN IF NOT EXISTS derniere_connexion TIMESTAMPTZ;

-- \`mot_de_passe_hash\` et \`etablissement_id\` restent nullables : des comptes
-- ont pu être créés avant cette migration. Un compte sans mot de passe ne peut
-- pas se connecter — c'est le comportement voulu, il faut le réinitialiser
-- explicitement plutôt que lui inventer un accès.

ALTER TABLE utilisateurs
    DROP CONSTRAINT IF EXISTS utilisateurs_role_check;

ALTER TABLE utilisateurs
    ADD CONSTRAINT utilisateurs_role_check
    CHECK (role IN ('educateur', 'coordinateur', 'admin'));

-- L'unicité de l'adresse est déjà garantie par la table ; on l'indexe en
-- minuscules pour que la connexion soit insensible à la casse sans permettre
-- deux comptes qui ne diffèrent que par elle.
CREATE UNIQUE INDEX IF NOT EXISTS idx_utilisateurs_email_minuscule
    ON utilisateurs (lower(email));

-- --- Sessions --------------------------------------------------------------

-- Jeton opaque tiré au hasard, conservé haché : une fuite de la base ne
-- permet pas de rejouer une session en cours. Aucun JWT — une session doit
-- pouvoir être révoquée immédiatement, ce qu'un jeton autoporteur interdit.
CREATE TABLE IF NOT EXISTS sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    jeton_hash TEXT NOT NULL UNIQUE,
    utilisateur_id UUID NOT NULL REFERENCES utilisateurs (id) ON DELETE CASCADE,
    creee_le TIMESTAMPTZ NOT NULL DEFAULT now(),
    expire_le TIMESTAMPTZ NOT NULL,
    derniere_activite TIMESTAMPTZ NOT NULL DEFAULT now(),
    adresse_ip TEXT,
    navigateur TEXT
);

CREATE INDEX IF NOT EXISTS idx_sessions_utilisateur ON sessions (utilisateur_id);
CREATE INDEX IF NOT EXISTS idx_sessions_expiration ON sessions (expire_le);

-- --- Rattachement des données existantes ------------------------------------

-- Les utilisateurs créés avant le cloisonnement n'ont pas d'établissement.
-- S'il n'en existe qu'un seul, le rattachement est sans ambiguïté ; sinon on
-- laisse la colonne vide, à renseigner à la main. Deviner produirait un
-- cloisonnement faux, pire que pas de cloisonnement du tout.
UPDATE utilisateurs u
SET etablissement_id = (SELECT id FROM etablissements LIMIT 1)
WHERE u.etablissement_id IS NULL
  AND (SELECT count(*) FROM etablissements) = 1;
`,
  },
  {
    nom: "011_audit_et_effacement.sql",
    sql: `-- Journal d'audit et droit à l'effacement.

-- --- Journal ---------------------------------------------------------------

-- Traçabilité exigée dans le médico-social, et registre des activités de
-- traitement (RGPD art. 30) : savoir qui a consulté ou modifié quel bilan,
-- et quand.
--
-- Les lectures sont journalisées au même titre que les écritures. C'est
-- justement l'accès non légitime à un dossier qu'un audit cherche, et il ne
-- laisse aucune autre trace.
CREATE TABLE IF NOT EXISTS audit_logs (
    id BIGSERIAL PRIMARY KEY,
    horodatage TIMESTAMPTZ NOT NULL DEFAULT now(),
    -- L'auteur peut disparaître ; la trace, non. D'où SET NULL plutôt que
    -- CASCADE, et un libellé recopié qui survit à la suppression.
    utilisateur_id UUID REFERENCES utilisateurs (id) ON DELETE SET NULL,
    utilisateur_libelle TEXT,
    etablissement_id UUID,
    action TEXT NOT NULL,
    cible_type TEXT,
    -- Pas de clé étrangère : l'effacement d'un bénéficiaire ne doit pas
    -- effacer la preuve qu'il a eu lieu.
    cible_id TEXT,
    cible_libelle TEXT,
    details JSONB,
    adresse_ip TEXT
);

CREATE INDEX IF NOT EXISTS idx_audit_horodatage ON audit_logs (horodatage DESC);
CREATE INDEX IF NOT EXISTS idx_audit_etablissement
    ON audit_logs (etablissement_id, horodatage DESC);
CREATE INDEX IF NOT EXISTS idx_audit_cible ON audit_logs (cible_type, cible_id);

-- --- Effacement ------------------------------------------------------------

-- Droit à l'effacement (RGPD art. 17) : supprimer un bénéficiaire doit
-- emporter ses bilans. Sans cascade, la suppression échouerait sur la clé
-- étrangère et le droit serait techniquement inapplicable.
ALTER TABLE bilans DROP CONSTRAINT IF EXISTS bilans_patient_id_fkey;
ALTER TABLE bilans
    ADD CONSTRAINT bilans_patient_id_fkey
    FOREIGN KEY (patient_id) REFERENCES patients (id) ON DELETE CASCADE;

-- Le bilan précédent d'un bilan supprimé : on coupe le lien sans supprimer
-- le bilan qui s'y référait.
ALTER TABLE bilans DROP CONSTRAINT IF EXISTS bilans_bilan_precedent_id_fkey;
ALTER TABLE bilans
    ADD CONSTRAINT bilans_bilan_precedent_id_fkey
    FOREIGN KEY (bilan_precedent_id) REFERENCES bilans (id) ON DELETE SET NULL;

-- L'auteur d'un bilan n'est jamais supprimé mais désactivé (cf. migration 010) :
-- effacer un compte ferait disparaître de l'archive l'identité du rédacteur.
-- La contrainte reste donc restrictive, volontairement.
`,
  },
  {
    nom: "012_coordonnees_etablissement.sql",
    sql: `-- Coordonnées de la structure, reprises dans l'en-tête des documents exportés.
--
-- Un bilan transmis à une famille ou à un partenaire doit porter l'identité de
-- l'établissement qui l'émet : sans cela le fichier produit ne ressemble pas au
-- document de la structure, et n'est pas utilisable tel quel.
ALTER TABLE etablissements
    ADD COLUMN IF NOT EXISTS adresse TEXT NOT NULL DEFAULT '',
    ADD COLUMN IF NOT EXISTS telephone TEXT NOT NULL DEFAULT '',
    ADD COLUMN IF NOT EXISTS email TEXT NOT NULL DEFAULT '';
`,
  },
  {
    nom: "013_create_brouillons_table.sql",
    sql: `-- Brouillons de saisie : le compte-rendu en cours de dictée, avant génération.
--
-- Ce texte n'était conservé nulle part. Il vivait dans la mémoire de l'onglet,
-- par une décision assumée : y écrire un compte-rendu dans le stockage du
-- navigateur aurait déposé des données de bénéficiaire sur le disque du poste,
-- hors de toute maîtrise. La conséquence, elle, ne l'était pas : un onglet
-- fermé par mégarde effaçait dix minutes de dictée relue — et contrairement à
-- du texte tapé, on ne re-dicte pas ce qu'on a dit.
--
-- La donnée revient donc là où elle est déjà protégée : en base, cloisonnée par
-- établissement, effacée en cascade avec le bénéficiaire. Le disque du poste
-- reste vierge.
--
-- Un brouillon par bénéficiaire et par rédacteur : deux éducateurs qui
-- préparent le même bilan ne s'écrasent pas l'un l'autre.
CREATE TABLE IF NOT EXISTS brouillons_saisie (
    patient_id UUID NOT NULL REFERENCES patients (id) ON DELETE CASCADE,
    utilisateur_id UUID NOT NULL REFERENCES utilisateurs (id) ON DELETE CASCADE,
    -- Recopié plutôt que déduit : toute lecture est bornée par l'établissement
    -- de la session, sans jointure sur \`patients\`.
    etablissement_id UUID NOT NULL REFERENCES etablissements (id),
    texte TEXT NOT NULL DEFAULT '',
    periode_debut DATE,
    periode_fin DATE,
    -- Le bilan généré porte la mention « dicté » ou « saisi » : l'information
    -- se perdrait si le brouillon ne la transportait pas.
    source_dictee BOOLEAN NOT NULL DEFAULT FALSE,
    maj_le TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (patient_id, utilisateur_id)
);

CREATE INDEX IF NOT EXISTS idx_brouillons_etablissement
    ON brouillons_saisie (etablissement_id);
`,
  },
];
