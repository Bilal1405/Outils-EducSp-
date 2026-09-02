-- Bilans éducatifs trimestriels générés par le moteur IA.
-- `contenu` stocke le JSON structuré défini dans SPEC-moteur-bilan.md.
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
