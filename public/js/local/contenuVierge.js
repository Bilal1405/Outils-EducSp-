/**
 * Contenu de départ d'un bilan rempli à la main.
 *
 * Transcription pour le navigateur de `contenuVierge` (src/schema/
 * modeleValidation.ts). Les deux doivent produire exactement la même chose :
 * un bilan ouvert sur un téléphone puis relu sur un poste, ou l'inverse, doit
 * avoir la même forme. `test/routeurLocal.test.ts` compare les deux sorties,
 * trame par trame, plutôt que de s'en remettre à la relecture.
 *
 * Tout part vide, et c'est délibéré : un bilan qui s'ouvrirait pré-rempli
 * ferait figurer des observations que personne n'a faites.
 */
import { MODELES_BILAN } from "./schema.js";

export function contenuVierge(type) {
  const modele = MODELES_BILAN.modeles[type];
  if (!modele) {
    throw new Error(`Trame inconnue : ${type}`);
  }

  const contenu = {};
  for (const etape of modele.etapes) {
    for (const bloc of etape.blocs) {
      switch (bloc.type) {
        case "champs":
          contenu[bloc.cle] = Object.fromEntries(bloc.champs.map((c) => [c.cle, ""]));
          break;
        case "tableau":
          contenu[bloc.cle] = Object.fromEntries(bloc.lignes.map((l) => [l.cle, ""]));
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
        default:
          // Un type de bloc ajouté aux trames sans passer par ici produirait un
          // bilan amputé de cette zone, sans que rien ne le signale.
          throw new Error(`Type de bloc non géré en local : ${bloc.type}`);
      }
    }
  }
  return contenu;
}
