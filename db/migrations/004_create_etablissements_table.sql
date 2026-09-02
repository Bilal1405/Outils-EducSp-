-- Établissements (cloisonnement des données, BRIEF_PROJET §8/§3 G-cloisonnement).
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
