-- Table minimale des professionnels/éducateurs, prérequis à la FK auteur_id de `bilans`.
-- Étendue par le reste de l'application au fil de l'eau.
CREATE TABLE IF NOT EXISTS utilisateurs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    nom TEXT NOT NULL,
    prenom TEXT NOT NULL,
    email TEXT NOT NULL UNIQUE,
    role TEXT NOT NULL DEFAULT 'educateur',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
