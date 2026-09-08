import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import request from "supertest";

/**
 * La porte par laquelle l'application installée sur un téléphone atteint le
 * moteur de rédaction — et le seul chemin par lequel quelque chose sort de
 * l'appareil.
 *
 * Ce qui est vérifié ici n'est pas une fonctionnalité mais une frontière :
 * qu'elle soit fermée quand rien ne l'ouvre, qu'elle refuse une clé qui n'est
 * pas la bonne, qu'elle compte chaque appareil séparément, et surtout qu'elle
 * **n'écrive rien**. Un serveur qui ne garde rien n'a rien à perdre, et ces
 * routes doivent répondre même quand la base est injoignable — c'est ce qui
 * permet à un praticien de rédiger pendant que l'hébergeur redémarre.
 */
vi.mock("../src/services/llmClient", () => ({ chatComplete: vi.fn() }));

/**
 * La base est bouchonnée pour que toute requête SQL soit visible : la
 * différence entre « n'écrit rien » et « écrit peu » ne se lit pas dans le
 * code, elle se compte.
 */
const requetesSql = vi.fn();
vi.mock("../src/db", async (importOriginal) => {
  const original = await importOriginal<typeof import("../src/db")>();
  return {
    ...original,
    pool: {
      query: (...args: unknown[]) => {
        requetesSql(...args);
        return Promise.resolve({ rows: [], rowCount: 0 });
      },
      executerScript: () => Promise.resolve(),
      transaction: () => Promise.resolve(),
    },
  };
});

import { chatComplete } from "../src/services/llmClient";
import { createApp } from "../src/app";
import { ENTETE_ANTI_CSRF } from "../src/middleware/authentification";
import { ENTETE_CLE_ACTIVATION } from "../src/middleware/cleActivation";
import { reinitialiserLimitation } from "../src/middleware/limitation";

const app = createApp();
const CLE = "cle-de-test-suffisamment-longue";

/** Un bilan minimal conforme au schéma de sortie du moteur. */
const BILAN_ATTENDU = {
  en_tete: {
    structure: "[A1]",
    periode_debut: "2026-04-01",
    periode_fin: "2026-06-30",
    beneficiaire_nom: "[B1]",
    beneficiaire_age: 12,
    beneficiaire_date_naissance: null,
    beneficiaire_lieu_naissance: null,
    professionnels_intervenants: ["[E1]"],
    jours_heures_intervention: "Mercredi, 14h-16h",
    lieux: "Accueil de répit",
    personnes_presentes: "[E1]",
    date_debut_intervention: "2026-04-01",
  },
  objectifs_intervention_periode: [
    {
      domaine_competence: "Autonomie vie quotidienne",
      objectif: "Se servir seul à table",
    },
  ],
  evaluation_comportement: [],
  donnees_complementaires: null,
  evaluation_objectifs_par_domaine: [],
  autres_observations: [],
  proposition_objectifs_periode_suivante: [],
};

function poster(chemin: string, corps: unknown, cle?: string) {
  const requete = request(app)
    .post(chemin)
    .set(ENTETE_ANTI_CSRF, "1")
    .send(corps as object);
  return cle === undefined ? requete : requete.set(ENTETE_CLE_ACTIVATION, cle);
}

describe("porte de la rédaction assistée", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requetesSql.mockClear();
    reinitialiserLimitation();
    process.env.CLES_ACTIVATION_LOCALE = CLE;
    vi.mocked(chatComplete).mockResolvedValue(JSON.stringify(BILAN_ATTENDU));
  });

  afterEach(() => {
    delete process.env.CLES_ACTIVATION_LOCALE;
  });

  it("est fermée tant qu'aucune clé n'est configurée sur le serveur", async () => {
    // L'oubli de configuration doit fermer, jamais ouvrir. Et il doit le dire :
    // un 401 laisserait croire à une clé mal saisie.
    delete process.env.CLES_ACTIVATION_LOCALE;
    const res = await poster("/api/local/redaction", { texte: "x" }, CLE);
    expect(res.status).toBe(503);
    expect(res.body.error).toMatch(/n'est pas ouverte sur ce serveur/i);
    expect(chatComplete).not.toHaveBeenCalled();
  });

  it("refuse une requête sans clé", async () => {
    const res = await poster("/api/local/redaction", { texte: "x" });
    expect(res.status).toBe(401);
    expect(chatComplete).not.toHaveBeenCalled();
  });

  it("refuse une clé qui n'est pas la bonne", async () => {
    const res = await poster("/api/local/redaction", { texte: "x" }, "autre-cle");
    expect(res.status).toBe(401);
    expect(chatComplete).not.toHaveBeenCalled();
  });

  it("refuse une écriture sans l'en-tête d'origine, clé valide ou non", async () => {
    // La garde CSRF s'applique avant : une clé d'activation n'est pas une
    // dispense.
    const res = await request(app)
      .post("/api/local/redaction")
      .set(ENTETE_CLE_ACTIVATION, CLE)
      .send({ texte: "x" });
    expect(res.status).toBe(403);
  });

  it("rédige avec une clé valide, et ne demande aucune session", async () => {
    const res = await poster(
      "/api/local/redaction",
      { texte: "Compte-rendu de la période." },
      CLE
    );
    expect(res.status).toBe(200);
    expect(res.body.contenu.en_tete.beneficiaire_nom).toBe("[B1]");
    expect(chatComplete).toHaveBeenCalledTimes(1);
  });

  it("n'écrit rien en base — ni bilan, ni journal, ni compteur", async () => {
    // C'est la propriété qui rend cette route acceptable : le document est
    // rédigé sur l'appareil, le serveur n'en garde pas de trace.
    await poster("/api/local/redaction", { texte: "Compte-rendu." }, CLE);
    await poster("/api/local/reformulation", { texte: "Compte-rendu." }, CLE);
    expect(requetesSql).not.toHaveBeenCalled();
  });

  it("ne transmet du bilan antérieur que les deux sections utiles", async () => {
    // L'en-tête d'un bilan porte le nom du bénéficiaire : il n'a aucune raison
    // de partir, et le schéma de la route le refuse.
    const res = await poster(
      "/api/local/redaction",
      {
        texte: "Compte-rendu.",
        precedent: {
          en_tete: { beneficiaire_nom: "Alex Martin" },
          evaluation_objectifs_par_domaine: [],
          proposition_objectifs_periode_suivante: [],
        },
      },
      CLE
    );
    expect(res.status).toBe(200);
    const envoye = JSON.stringify(vi.mocked(chatComplete).mock.calls[0][0]);
    expect(envoye).not.toContain("Alex Martin");
  });

  it("refuse un compte-rendu vide plutôt que d'appeler le moteur", async () => {
    const res = await poster("/api/local/redaction", { texte: "" }, CLE);
    expect(res.status).toBe(400);
    expect(chatComplete).not.toHaveBeenCalled();
  });

  it("compte le plafond par appareil, et non pour tout le monde à la fois", async () => {
    process.env.CLES_ACTIVATION_LOCALE = `${CLE},seconde-cle-de-test-longue`;

    for (let appel = 0; appel < 20; appel += 1) {
      const res = await poster("/api/local/redaction", { texte: "x" }, CLE);
      expect(res.status).toBe(200);
    }
    const bloque = await poster("/api/local/redaction", { texte: "x" }, CLE);
    expect(bloque.status).toBe(429);

    // Le second appareil n'a rien consommé : sans identité par clé, il aurait
    // trouvé la porte fermée sans avoir rien demandé.
    const autre = await poster(
      "/api/local/redaction",
      { texte: "x" },
      "seconde-cle-de-test-longue"
    );
    expect(autre.status).toBe(200);
  });

  it("reformule par le même chemin, avec la même clé", async () => {
    vi.mocked(chatComplete).mockResolvedValue("Texte remis au propre.");
    const res = await poster(
      "/api/local/reformulation",
      { texte: "il a bien joué avec les autres", intitule: "Socialisation" },
      CLE
    );
    expect(res.status).toBe(200);
    expect(res.body.texte).toBe("Texte remis au propre.");
  });
});
