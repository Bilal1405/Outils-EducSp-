import { z } from "zod";
import {
  MODELES,
  type BlocBilan,
  type ModeleBilan,
  type TypeBilan,
  blocsDuModele,
} from "./modelesBilan";
import { BilanSchema } from "./bilan.schema";

/**
 * Construit le schéma Zod d'un bilan à trame fixe à partir de sa description.
 *
 * Le schéma n'est jamais écrit à la main : il se déduit de `modelesBilan.ts`,
 * qui décrit aussi le formulaire et l'export. Ajouter une ligne à une grille
 * suffit donc à l'admettre partout, et il devient impossible d'enregistrer un
 * contenu qui ne correspond plus au document.
 *
 * Deux règles traversent toute la construction :
 *
 *  - la chaîne vide est toujours acceptée. Une ligne non cotée, un commentaire
 *    non rempli sont des états légitimes : le document se remplit en plusieurs
 *    passes, et une absence d'observation doit rester lisible comme telle
 *    plutôt que d'être comblée ;
 *  - aucun champ n'a de valeur par défaut. Rien ne se remplit tout seul.
 */

/** `z.enum` exige un tuple non vide : on l'y ramène explicitement. */
function enumAvecVide(options: readonly string[]) {
  const valeurs = ["", ...options] as [string, ...string[]];
  return z.enum(valeurs);
}

function schemaDuBloc(bloc: BlocBilan, modele: ModeleBilan): z.ZodTypeAny {
  switch (bloc.type) {
    case "champs":
      return z.object(
        Object.fromEntries(
          bloc.champs.map((champ) => [
            champ.cle,
            champ.saisie === "choix" && champ.options
              ? enumAvecVide(champ.options)
              : z.string(),
          ])
        )
      );

    case "tableau": {
      const options = modele.echelles[bloc.echelle];
      if (!options) {
        throw new Error(
          `Échelle « ${bloc.echelle} » absente du modèle ${modele.type} (bloc ${bloc.cle})`
        );
      }
      return z.object(
        Object.fromEntries(
          bloc.lignes.map((ligne) => [ligne.cle, enumAvecVide(options)])
        )
      );
    }

    case "texte":
      return z.string();

    case "liste":
      return z.array(z.string());

    case "grille":
      return z.object(
        Object.fromEntries(
          bloc.lignes.map((ligne) => [
            ligne.cle,
            z.object(
              Object.fromEntries(
                bloc.colonnes.map((colonne) => [
                  colonne.cle,
                  colonne.saisie === "choix" && colonne.options
                    ? enumAvecVide(colonne.options)
                    : z.string(),
                ])
              )
            ),
          ])
        )
      );

    case "repetable":
      return z.array(
        z.object(
          Object.fromEntries(
            bloc.colonnes.map((colonne) => [
              colonne.cle,
              colonne.saisie === "choix" && colonne.options
                ? enumAvecVide(colonne.options)
                : z.string(),
            ])
          )
        )
      );
  }
}

function schemaDepuisModele(modele: ModeleBilan) {
  return z.object(
    Object.fromEntries(
      blocsDuModele(modele).map((bloc) => [bloc.cle, schemaDuBloc(bloc, modele)])
    )
  );
}

export const RepitSchema = schemaDepuisModele(MODELES.repit);
export const TrimestrielSchema = schemaDepuisModele(MODELES.trimestriel);

/**
 * Schéma de validation associé à un type de bilan. Le type « bilan » conserve
 * la structure historique produite par le moteur ; les deux autres suivent la
 * trame de leur document d'origine.
 */
export function schemaPourType(type: TypeBilan): z.ZodTypeAny {
  switch (type) {
    case "bilan":
      return BilanSchema;
    case "repit":
      return RepitSchema;
    case "trimestriel":
      return TrimestrielSchema;
    default: {
      const jamais: never = type;
      throw new Error(`Type de bilan non géré : ${jamais}`);
    }
  }
}

/**
 * Contenu vierge d'un bilan à trame fixe : toutes les clés présentes, toutes
 * les valeurs vides. Le formulaire part de là, ce qui garantit qu'un
 * enregistrement partiel reste valide et qu'aucune section ne disparaît parce
 * qu'elle n'a pas encore été remplie.
 */
export function contenuVierge(type: Exclude<TypeBilan, "bilan">): unknown {
  const modele = MODELES[type];
  const contenu: Record<string, unknown> = {};

  for (const bloc of blocsDuModele(modele)) {
    switch (bloc.type) {
      case "champs":
        contenu[bloc.cle] = Object.fromEntries(
          bloc.champs.map((champ) => [champ.cle, ""])
        );
        break;
      case "tableau":
        contenu[bloc.cle] = Object.fromEntries(
          bloc.lignes.map((ligne) => [ligne.cle, ""])
        );
        break;
      case "texte":
        contenu[bloc.cle] = "";
        break;
      case "liste":
        contenu[bloc.cle] = [];
        break;
      case "grille":
        contenu[bloc.cle] = Object.fromEntries(
          bloc.lignes.map((ligne) => [
            ligne.cle,
            Object.fromEntries(bloc.colonnes.map((colonne) => [colonne.cle, ""])),
          ])
        );
        break;
      case "repetable":
        contenu[bloc.cle] = [];
        break;
    }
  }

  return contenu;
}
