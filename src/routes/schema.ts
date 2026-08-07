import { Router } from "express";
import {
  DOMAINES_COMPETENCE,
  TYPES_COMPORTEMENT,
  FREQUENCES_COMPORTEMENT,
} from "../schema/bilan.schema";
import { MODELES, LIBELLES_TYPE_BILAN, TYPES_BILAN } from "../schema/modelesBilan";

export const schemaRouter = Router();

/**
 * Listes fermées du schéma bilan, publiées pour l'interface.
 *
 * L'écran de relecture propose ces valeurs dans des menus déroulants plutôt
 * qu'en saisie libre : l'éducateur ne peut pas produire un bilan que la
 * validation serveur rejettera ensuite. Les recopier dans `public/` en ferait
 * une seconde définition, vouée à diverger de `bilan.schema.ts` — qui reste la
 * source unique.
 */
schemaRouter.get("/api/schema/bilan", (_req, res) => {
  res.json({
    domaines_competence: DOMAINES_COMPETENCE,
    types_comportement: TYPES_COMPORTEMENT,
    frequences_comportement: FREQUENCES_COMPORTEMENT,
  });
});

/**
 * Trames complètes des bilans Répit et Trimestriel : étapes, grilles de
 * cotation, échelles, zones de commentaire.
 *
 * C'est cette description qui construit le formulaire guidé côté navigateur.
 * Elle est publiée plutôt que recopiée dans `public/` parce qu'elle sert aussi
 * à valider le contenu enregistré et à produire l'export .docx : une ligne
 * ajoutée à une grille doit apparaître dans les trois, ou nulle part.
 */
schemaRouter.get("/api/schema/modeles", (_req, res) => {
  res.json({
    types: TYPES_BILAN.map((type) => ({
      type,
      libelle: LIBELLES_TYPE_BILAN[type],
    })),
    modeles: MODELES,
  });
});
