-- Brouillons de saisie : le compte-rendu en cours de dictée, avant génération.
--
-- Ce texte n'était conservé nulle part. Il vivait dans la mémoire de l'onglet,
-- par une décision assumée : y écrire un compte-rendu dans le stockage du
-- navigateur aurait déposé des données de bénéficiaire sur le disque du poste,
-- hors de toute maîtrise. La conséquence, elle, ne l'était pas : un onglet
-- fermé par mégarde effaçait dix minutes de dictée relue — et contrairement à
-- du texte tapé, on ne re-dicte pas ce qu'on a dit.
--
-- La donnée revient donc là où elle est déjà protégée : en base, cloisonnée par
-- établissement, effacée en cascade avec le bénéficiaire. Le disque du poste
-- reste vierge.
--
-- Un brouillon par bénéficiaire et par rédacteur : deux éducateurs qui
-- préparent le même bilan ne s'écrasent pas l'un l'autre.
CREATE TABLE IF NOT EXISTS brouillons_saisie (
    patient_id UUID NOT NULL REFERENCES patients (id) ON DELETE CASCADE,
    utilisateur_id UUID NOT NULL REFERENCES utilisateurs (id) ON DELETE CASCADE,
    -- Recopié plutôt que déduit : toute lecture est bornée par l'établissement
    -- de la session, sans jointure sur `patients`.
    etablissement_id UUID NOT NULL REFERENCES etablissements (id),
    texte TEXT NOT NULL DEFAULT '',
    periode_debut DATE,
    periode_fin DATE,
    -- Le bilan généré porte la mention « dicté » ou « saisi » : l'information
    -- se perdrait si le brouillon ne la transportait pas.
    source_dictee BOOLEAN NOT NULL DEFAULT FALSE,
    maj_le TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (patient_id, utilisateur_id)
);

CREATE INDEX IF NOT EXISTS idx_brouillons_etablissement
    ON brouillons_saisie (etablissement_id);
