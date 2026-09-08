-- Journal d'audit et droit à l'effacement.

-- --- Journal ---------------------------------------------------------------

-- Traçabilité exigée dans le médico-social, et registre des activités de
-- traitement (RGPD art. 30) : savoir qui a consulté ou modifié quel bilan,
-- et quand.
--
-- Les lectures sont journalisées au même titre que les écritures. C'est
-- justement l'accès non légitime à un dossier qu'un audit cherche, et il ne
-- laisse aucune autre trace.
CREATE TABLE IF NOT EXISTS audit_logs (
    id BIGSERIAL PRIMARY KEY,
    horodatage TIMESTAMPTZ NOT NULL DEFAULT now(),
    -- L'auteur peut disparaître ; la trace, non. D'où SET NULL plutôt que
    -- CASCADE, et un libellé recopié qui survit à la suppression.
    utilisateur_id UUID REFERENCES utilisateurs (id) ON DELETE SET NULL,
    utilisateur_libelle TEXT,
    etablissement_id UUID,
    action TEXT NOT NULL,
    cible_type TEXT,
    -- Pas de clé étrangère : l'effacement d'un bénéficiaire ne doit pas
    -- effacer la preuve qu'il a eu lieu.
    cible_id TEXT,
    cible_libelle TEXT,
    details JSONB,
    adresse_ip TEXT
);

CREATE INDEX IF NOT EXISTS idx_audit_horodatage ON audit_logs (horodatage DESC);
CREATE INDEX IF NOT EXISTS idx_audit_etablissement
    ON audit_logs (etablissement_id, horodatage DESC);
CREATE INDEX IF NOT EXISTS idx_audit_cible ON audit_logs (cible_type, cible_id);

-- --- Effacement ------------------------------------------------------------

-- Droit à l'effacement (RGPD art. 17) : supprimer un bénéficiaire doit
-- emporter ses bilans. Sans cascade, la suppression échouerait sur la clé
-- étrangère et le droit serait techniquement inapplicable.
ALTER TABLE bilans DROP CONSTRAINT IF EXISTS bilans_patient_id_fkey;
ALTER TABLE bilans
    ADD CONSTRAINT bilans_patient_id_fkey
    FOREIGN KEY (patient_id) REFERENCES patients (id) ON DELETE CASCADE;

-- Le bilan précédent d'un bilan supprimé : on coupe le lien sans supprimer
-- le bilan qui s'y référait.
ALTER TABLE bilans DROP CONSTRAINT IF EXISTS bilans_bilan_precedent_id_fkey;
ALTER TABLE bilans
    ADD CONSTRAINT bilans_bilan_precedent_id_fkey
    FOREIGN KEY (bilan_precedent_id) REFERENCES bilans (id) ON DELETE SET NULL;

-- L'auteur d'un bilan n'est jamais supprimé mais désactivé (cf. migration 010) :
-- effacer un compte ferait disparaître de l'archive l'identité du rédacteur.
-- La contrainte reste donc restrictive, volontairement.
