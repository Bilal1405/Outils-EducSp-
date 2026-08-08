-- Authentification réelle et cloisonnement.
--
-- Jusqu'ici l'identité de l'auteur venait d'un en-tête `x-user-id` que le
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

-- `mot_de_passe_hash` et `etablissement_id` restent nullables : des comptes
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
