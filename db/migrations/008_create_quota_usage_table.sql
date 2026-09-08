-- Compteur de quota mensuel de génération de bilans par établissement
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
