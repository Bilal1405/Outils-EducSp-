-- Traçabilité G3 : référence explicite au bilan précédent utilisé comme
-- contexte de génération (BIL-03), le cas échéant.
ALTER TABLE bilans
    ADD COLUMN IF NOT EXISTS bilan_precedent_id UUID REFERENCES bilans (id);
