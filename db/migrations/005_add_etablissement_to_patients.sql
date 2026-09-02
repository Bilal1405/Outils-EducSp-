-- Cloisonnement patients par établissement (BRIEF_PROJET §8).
ALTER TABLE patients
    ADD COLUMN IF NOT EXISTS etablissement_id UUID REFERENCES etablissements (id);

UPDATE patients SET etablissement_id = '00000000-0000-0000-0000-000000000001'
    WHERE etablissement_id IS NULL;

ALTER TABLE patients
    ALTER COLUMN etablissement_id SET NOT NULL;

CREATE INDEX IF NOT EXISTS idx_patients_etablissement_id ON patients (etablissement_id);
