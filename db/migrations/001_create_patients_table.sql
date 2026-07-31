-- Table minimale des bénéficiaires, prérequis à la FK patient_id de `bilans`.
-- Étendue par le reste de l'application au fil de l'eau.
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS patients (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    nom TEXT NOT NULL,
    prenom TEXT NOT NULL,
    date_naissance DATE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
