-- Coordonnées de la structure, reprises dans l'en-tête des documents exportés.
--
-- Un bilan transmis à une famille ou à un partenaire doit porter l'identité de
-- l'établissement qui l'émet : sans cela le fichier produit ne ressemble pas au
-- document de la structure, et n'est pas utilisable tel quel.
ALTER TABLE etablissements
    ADD COLUMN IF NOT EXISTS adresse TEXT NOT NULL DEFAULT '',
    ADD COLUMN IF NOT EXISTS telephone TEXT NOT NULL DEFAULT '',
    ADD COLUMN IF NOT EXISTS email TEXT NOT NULL DEFAULT '';
