-- Trois trames de bilan coexistent désormais :
--   'bilan'       — état des lieux des compétences, rédigé par le moteur à
--                   partir d'un compte-rendu dicté ou saisi ;
--   'repit'       — bilan individuel de fin de séjour en répit, saisi par
--                   l'éducateur dans un parcours guidé ;
--   'trimestriel' — bilan trimestriel PCPE, même parcours guidé.
--
-- Les bilans déjà enregistrés suivent la structure historique : ils prennent
-- 'bilan', qui est exactement celle-là. Aucune reprise de données n'est
-- nécessaire et aucun bilan existant ne devient illisible.
--
-- La contrainte est posée en CHECK plutôt qu'en type ENUM : ajouter une trame
-- ne demandera qu'un ALTER de la contrainte, sans migration de type.
ALTER TABLE bilans
    ADD COLUMN IF NOT EXISTS type_bilan TEXT NOT NULL DEFAULT 'bilan';

ALTER TABLE bilans
    DROP CONSTRAINT IF EXISTS bilans_type_bilan_check;

ALTER TABLE bilans
    ADD CONSTRAINT bilans_type_bilan_check
    CHECK (type_bilan IN ('bilan', 'repit', 'trimestriel'));

-- L'historique d'un bénéficiaire se lit par type : un éducateur cherche « le
-- dernier trimestriel », pas « le dernier bilan ».
CREATE INDEX IF NOT EXISTS idx_bilans_patient_type
    ON bilans (patient_id, type_bilan, periode_fin DESC);
