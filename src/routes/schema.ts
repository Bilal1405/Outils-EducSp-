import { Router } from "express";
import {
  DOMAINES_COMPETENCE,
  TYPES_COMPORTEMENT,
  FREQUENCES_COMPORTEMENT,
} from "../schema/bilan.schema";

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
