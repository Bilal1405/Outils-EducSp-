import { vi } from "vitest";
import type { Test } from "supertest";
import { NOM_COOKIE } from "../../src/services/sessionService";
import { ENTETE_ANTI_CSRF } from "../../src/middleware/authentification";
import type { RoleUtilisateur, Utilisateur } from "../../src/repositories/utilisateurRepository";

/**
 * Aide de test pour les routes authentifiées.
 *
 * Les tests traversent la vraie chaîne d'intergiciels — résolution de session,
 * garde CSRF, exigence de rôle — et ne bouchonnent que la lecture en base du
 * jeton. Contourner l'authentification dans les tests reviendrait à ne jamais
 * la tester, alors que c'est elle qui protège les données.
 */

export const UTILISATEUR_TEST: Utilisateur = {
  id: "auteur-1",
  nom: "Dubois",
  prenom: "Marie",
  email: "marie.dubois@exemple.fr",
  role: "educateur",
  etablissement_id: "etab-1",
  actif: true,
};

export const JETON_TEST = "jeton-de-test";

type ResoudreSession = typeof import("../../src/services/sessionService").resoudreSession;

/** Session résolue par défaut ; à appeler dans un `beforeEach`. */
export function bouchonnerSession(
  resoudreSession: ResoudreSession,
  utilisateur: Partial<Utilisateur> = {}
) {
  vi.mocked(resoudreSession).mockImplementation(async (jeton: string) =>
    jeton === JETON_TEST
      ? {
          sessionId: "session-1",
          utilisateur: { ...UTILISATEUR_TEST, ...utilisateur },
        }
      : null
  );
}

export function avecRole(role: RoleUtilisateur): Partial<Utilisateur> {
  return { role };
}

/** Ajoute le cookie de session et l'en-tête anti-CSRF à une requête supertest. */
export function connecte(requete: Test): Test {
  return requete
    .set("Cookie", `${NOM_COOKIE}=${JETON_TEST}`)
    .set(ENTETE_ANTI_CSRF, "1");
}
