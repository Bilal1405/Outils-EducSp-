import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";

vi.mock("../src/services/sauvegardeService", () => ({
  exporterEtablissement: vi.fn().mockResolvedValue({
    version: 1,
    exporte_le: "2026-08-19T10:00:00.000Z",
    etablissement: { id: "etab-1", nom: "PCPE" },
    utilisateurs: [],
    beneficiaires: [],
    bilans: [],
    quotas: [],
    audit: [],
  }),
  dateDerniereSauvegarde: vi.fn().mockResolvedValue(null),
}));

vi.mock("../src/repositories/brouillonRepository", () => ({
  getBrouillon: vi.fn().mockResolvedValue(null),
  enregistrerBrouillon: vi.fn().mockResolvedValue({}),
  supprimerBrouillon: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../src/repositories/patientRepository", () => ({
  listPatients: vi.fn().mockResolvedValue([]),
  getPatientById: vi.fn(),
  creerPatient: vi.fn().mockResolvedValue({ id: "patient-1" }),
  updatePatient: vi.fn(),
  supprimerPatient: vi.fn().mockResolvedValue(2),
}));

vi.mock("../src/repositories/bilanRepository", () => ({
  getDernierBilanValide: vi.fn(),
  getDernierBilanDeTrame: vi.fn(),
  creerBilanBrouillon: vi.fn(),
  getBilanById: vi.fn(),
  getBilanAvecBeneficiaire: vi.fn(),
  listBilansForPatient: vi.fn().mockResolvedValue([]),
  tableauDeBord: vi.fn().mockResolvedValue([]),
  updateBilan: vi.fn(),
}));

vi.mock("../src/repositories/utilisateurRepository", () => ({
  listUtilisateurs: vi.fn().mockResolvedValue([]),
  getUtilisateurById: vi.fn(),
  getUtilisateurParEmail: vi.fn(),
  creerUtilisateur: vi.fn(),
  desactiverUtilisateur: vi.fn(),
  changerMotDePasse: vi.fn(),
  marquerConnexion: vi.fn(),
  aucunUtilisateur: vi.fn().mockResolvedValue(false),
}));

vi.mock("../src/repositories/etablissementRepository", () => ({
  getEtablissementById: vi.fn().mockResolvedValue(null),
  creerEtablissement: vi.fn(),
  mettreAJourEtablissement: vi.fn(),
}));

vi.mock("../src/services/quotaService", () => ({
  getQuotaStatus: vi.fn(),
  decrementerQuota: vi.fn(),
}));

vi.mock("../src/services/llmClient", () => ({ chatComplete: vi.fn() }));

vi.mock("../src/services/auditService", () => ({
  journaliser: vi.fn(),
  listerAudit: vi.fn().mockResolvedValue([]),
}));

vi.mock("../src/services/sessionService", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/services/sessionService")>()),
  resoudreSession: vi.fn(),
  prolongerSession: vi.fn(),
  fermerSessionsDe: vi.fn(),
}));

import {
  getPatientById,
  listPatients,
  supprimerPatient,
} from "../src/repositories/patientRepository";
import { getBilanById } from "../src/repositories/bilanRepository";
import {
  enregistrerBrouillon,
  getBrouillon,
  supprimerBrouillon,
} from "../src/repositories/brouillonRepository";
import { getEtablissementById } from "../src/repositories/etablissementRepository";
import { listUtilisateurs } from "../src/repositories/utilisateurRepository";
import { getQuotaStatus } from "../src/services/quotaService";
import { exporterEtablissement } from "../src/services/sauvegardeService";
import { resoudreSession } from "../src/services/sessionService";
import { createApp } from "../src/app";
import { bouchonnerSession, connecte, JETON_TEST } from "./aide/session";
import { NOM_COOKIE } from "../src/services/sessionService";
import { reinitialiserLimitation } from "../src/middleware/limitation";

const app = createApp();

/**
 * Ces contrôles portent sur la frontière elle-même, pas sur une
 * fonctionnalité. Ils sont la seule preuve automatisée que les données d'un
 * établissement ne sortent pas vers un autre, et que l'identité n'est plus
 * déclarative.
 */
describe("aucune session", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    reinitialiserLimitation();
    bouchonnerSession(resoudreSession);
  });

  const routesLecture = [
    "/api/amorcage",
    "/api/patients",
    "/api/patients/patient-1",
    "/api/patients/patient-1/brouillon",
    "/api/patients/patient-1/bilans",
    "/api/bilans/bilan-1",
    "/api/bilans/bilan-1/export.docx",
    "/api/utilisateurs",
    "/api/etablissement",
    "/api/etablissement/quota",
    "/api/etablissement/audit",
    "/api/etablissement/sauvegarde",
    "/api/tableau-de-bord",
    "/api/schema/bilan",
    "/api/schema/modeles",
  ];

  it.each(routesLecture)("refuse la lecture de %s", async (route) => {
    const res = await request(app).get(route);
    expect(res.status).toBe(401);
  });

  const routesEcriture: [string, string][] = [
    ["post", "/api/patients"],
    ["put", "/api/patients/patient-1/brouillon"],
    ["delete", "/api/patients/patient-1/brouillon"],
    ["patch", "/api/patients/patient-1"],
    ["delete", "/api/patients/patient-1"],
    ["post", "/api/patients/patient-1/bilans"],
    ["post", "/api/patients/patient-1/bilans/generate"],
    ["patch", "/api/bilans/bilan-1"],
    ["post", "/api/utilisateurs"],
    ["post", "/api/assistance/reformulation"],
  ];

  it.each(routesEcriture)("refuse %s %s", async (methode, route) => {
    const agent = request(app);
    const requete =
      methode === "post"
        ? agent.post(route)
        : methode === "patch"
          ? agent.patch(route)
          : methode === "put"
            ? agent.put(route)
            : agent.delete(route);

    // L'en-tête anti-CSRF est fourni : ce qui est vérifié ici est bien
    // l'absence de session, pas le rejet CSRF qui la précède.
    const res = await requete.set("x-outils-educsp", "1").send({});
    expect(res.status).toBe(401);
  });

  it("ne divulgue pas l'existence d'un bilan", async () => {
    const res = await request(app).get("/api/bilans/bilan-1");
    expect(res.status).toBe(401);
    expect(getBilanById).not.toHaveBeenCalled();
  });
});

describe("protection CSRF", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    reinitialiserLimitation();
    bouchonnerSession(resoudreSession);
  });

  it("refuse une écriture sans l'en-tête d'origine, même authentifiée", async () => {
    const res = await request(app)
      .post("/api/patients")
      .set("Cookie", `${NOM_COOKIE}=${JETON_TEST}`)
      .send({ nom: "Dupont", prenom: "Alice" });

    expect(res.status).toBe(403);
  });

  it("laisse passer la lecture sans en-tête : elle ne modifie rien", async () => {
    const res = await request(app)
      .get("/api/patients")
      .set("Cookie", `${NOM_COOKIE}=${JETON_TEST}`);

    expect(res.status).toBe(200);
  });
});

describe("cloisonnement par établissement", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    reinitialiserLimitation();
    bouchonnerSession(resoudreSession);
  });

  it("interroge toujours la base avec l'établissement de la session", async () => {
    vi.mocked(getPatientById).mockResolvedValue(null);

    await connecte(request(app).get("/api/patients/patient-dautrui"));

    expect(getPatientById).toHaveBeenCalledWith("patient-dautrui", "etab-1");
  });

  it("répond 404, et non 403, pour une ressource d'un autre établissement", async () => {
    // Un 403 confirmerait l'existence de la ressource et permettrait de sonder
    // les autres structures ; le 404 ne dit rien.
    vi.mocked(getPatientById).mockResolvedValue(null);

    const res = await connecte(request(app).get("/api/patients/patient-dautrui"));
    expect(res.status).toBe(404);
  });

  it("ne laisse pas l'appelant choisir son établissement", async () => {
    await connecte(request(app).get("/api/patients?etablissement_id=etab-2"));

    const { listPatients } = await import("../src/repositories/patientRepository");
    expect(listPatients).toHaveBeenCalledWith("etab-1");
  });
});

/**
 * L'amorçage rassemble en une réponse ce que cinq routes servaient séparément.
 * Regrouper des lectures ne doit pas relâcher ce qui les bornait : c'est
 * exactement le genre de route où un établissement pourrait fuir vers un
 * autre sans que rien ne le signale à l'écran.
 */
describe("amorçage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    reinitialiserLimitation();
    bouchonnerSession(resoudreSession);
    vi.mocked(getEtablissementById).mockResolvedValue({
      id: "etab-1",
      nom: "PCPE",
      adresse: "",
      telephone: "",
      email: "",
      quota_mensuel_bilans: 50,
    });
  });

  it("borne toutes ses lectures à l'établissement de la session", async () => {
    const res = await connecte(request(app).get("/api/amorcage"));

    expect(res.status).toBe(200);
    expect(getEtablissementById).toHaveBeenCalledWith("etab-1");
    expect(listPatients).toHaveBeenCalledWith("etab-1");
    expect(getQuotaStatus).toHaveBeenCalledWith("etab-1");
  });

  it("ne lit pas la liste des comptes pour un éducateur", async () => {
    // Ne pas la lire du tout, plutôt que la lire puis l'ôter de la réponse :
    // le second oubli est silencieux.
    bouchonnerSession(resoudreSession, { role: "educateur" });

    const res = await connecte(request(app).get("/api/amorcage"));

    expect(res.status).toBe(200);
    expect(res.body.equipe).toBeNull();
    expect(listUtilisateurs).not.toHaveBeenCalled();
  });

  it("la lit pour un coordinateur", async () => {
    bouchonnerSession(resoudreSession, { role: "coordinateur" });

    await connecte(request(app).get("/api/amorcage"));

    expect(listUtilisateurs).toHaveBeenCalledWith("etab-1");
  });
});

/**
 * Le brouillon de saisie est du texte dicté sur un bénéficiaire : une donnée
 * de santé, avec les mêmes exigences que le reste. Deux frontières à tenir —
 * l'établissement, et le rédacteur.
 */
describe("brouillon de saisie", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    reinitialiserLimitation();
    bouchonnerSession(resoudreSession);
    vi.mocked(getPatientById).mockResolvedValue({
      id: "patient-1",
      nom: "Dupont",
      prenom: "Alice",
      date_naissance: null,
      etablissement_id: "etab-1",
    });
  });

  it("ne lit que le sien, dans son établissement", async () => {
    await connecte(request(app).get("/api/patients/patient-1/brouillon"));

    expect(getBrouillon).toHaveBeenCalledWith("patient-1", "auteur-1", "etab-1");
  });

  it("refuse un bénéficiaire d'un autre établissement", async () => {
    vi.mocked(getPatientById).mockResolvedValue(null);

    const res = await connecte(
      request(app)
        .put("/api/patients/patient-dautrui/brouillon")
        .send({ texte: "essai" })
    );

    expect(res.status).toBe(404);
    expect(enregistrerBrouillon).not.toHaveBeenCalled();
  });

  it("écrit au nom du rédacteur de la session, jamais d'un autre", async () => {
    await connecte(
      request(app)
        .put("/api/patients/patient-1/brouillon")
        .send({ texte: "séance du matin", utilisateur_id: "quelquun-dautre" })
    );

    expect(enregistrerBrouillon).toHaveBeenCalledWith(
      "patient-1",
      "auteur-1",
      "etab-1",
      expect.objectContaining({ texte: "séance du matin" })
    );
  });

  it("efface plutôt que de conserver un brouillon vidé", async () => {
    // Un texte effacé par l'éducateur est une donnée de santé qu'on ne garde
    // pas « au cas où ».
    const res = await connecte(
      request(app).put("/api/patients/patient-1/brouillon").send({ texte: "   " })
    );

    expect(res.status).toBe(204);
    expect(supprimerBrouillon).toHaveBeenCalledWith("patient-1", "auteur-1", "etab-1");
    expect(enregistrerBrouillon).not.toHaveBeenCalled();
  });
});

describe("rôles", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    reinitialiserLimitation();
  });

  it("refuse la suppression d'un bénéficiaire à un éducateur", async () => {
    bouchonnerSession(resoudreSession, { role: "educateur" });
    vi.mocked(getPatientById).mockResolvedValue({
      id: "patient-1",
      nom: "Dupont",
      prenom: "Alice",
      date_naissance: null,
      etablissement_id: "etab-1",
    });

    const res = await connecte(request(app).delete("/api/patients/patient-1"));

    expect(res.status).toBe(403);
    expect(supprimerPatient).not.toHaveBeenCalled();
  });

  it("l'autorise à un coordinateur, et journalise l'étendue de l'effacement", async () => {
    bouchonnerSession(resoudreSession, { role: "coordinateur" });
    vi.mocked(getPatientById).mockResolvedValue({
      id: "patient-1",
      nom: "Dupont",
      prenom: "Alice",
      date_naissance: null,
      etablissement_id: "etab-1",
    });

    const res = await connecte(request(app).delete("/api/patients/patient-1"));

    expect(res.status).toBe(200);
    expect(supprimerPatient).toHaveBeenCalledWith("patient-1", "etab-1");
    expect(res.body).toEqual({ supprime: true, bilans_supprimes: 2 });

    const { journaliser } = await import("../src/services/auditService");
    expect(journaliser).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "beneficiaire_supprime",
        details: { bilans_supprimes: 2 },
      })
    );
  });

  it("refuse le journal d'audit à un éducateur", async () => {
    bouchonnerSession(resoudreSession, { role: "educateur" });
    const res = await connecte(request(app).get("/api/etablissement/audit"));
    expect(res.status).toBe(403);
  });

  /**
   * Une sauvegarde, c'est l'intégralité des dossiers dans un fichier qui
   * quittera l'application. Le rôle qui l'autorise est donc le même que celui
   * du journal d'audit, et pour la même raison.
   */
  it("refuse la sauvegarde complète à un éducateur", async () => {
    bouchonnerSession(resoudreSession, { role: "educateur" });
    const res = await connecte(request(app).get("/api/etablissement/sauvegarde"));
    expect(res.status).toBe(403);
    expect(exporterEtablissement).not.toHaveBeenCalled();
  });

  it("l'autorise au coordinateur, et laisse une trace de qui l'a emportée", async () => {
    bouchonnerSession(resoudreSession, { role: "coordinateur" });

    const res = await connecte(request(app).get("/api/etablissement/sauvegarde"));

    expect(res.status).toBe(200);
    expect(exporterEtablissement).toHaveBeenCalledWith("etab-1");
    expect(res.headers["content-disposition"]).toContain("sauvegarde-bilans-");
    // Ce fichier ne doit rester ni dans un cache navigateur ni chez un
    // intermédiaire.
    expect(res.headers["cache-control"]).toBe("no-store");

    const { journaliser } = await import("../src/services/auditService");
    expect(journaliser).toHaveBeenCalledWith(
      expect.objectContaining({ action: "sauvegarde_exportee" })
    );
  });

  it("refuse le tableau de bord à un éducateur", async () => {
    bouchonnerSession(resoudreSession, { role: "educateur" });
    const res = await connecte(request(app).get("/api/tableau-de-bord"));
    expect(res.status).toBe(403);
  });
});

describe("compte sans établissement", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    reinitialiserLimitation();
  });

  it("est refusé avec un message explicite plutôt que de voir toutes les données", async () => {
    bouchonnerSession(resoudreSession, { etablissement_id: null });

    const res = await connecte(request(app).get("/api/patients"));

    expect(res.status).toBe(403);
    expect(res.body.error).toContain("rattaché à aucun établissement");
  });
});
