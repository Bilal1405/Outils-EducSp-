-- Table minimale des bénéficiaires, prérequis à la FK patient_id de `bilans`.
-- Étendue par le reste de l'application au fil de l'eau.
-- `gen_random_uuid()` est natif depuis PostgreSQL 13 : l'extension pgcrypto
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
