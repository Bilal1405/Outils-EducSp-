-- Cloisonnement bilans par établissement (BRIEF_PROJET §8). Dénormalisé
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
