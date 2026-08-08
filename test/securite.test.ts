import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";

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

import { getPatientById, supprimerPatient } from "../src/repositories/patientRepository";
import { getBilanById } from "../src/repositories/bilanRepository";
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
    "/api/patients",
    "/api/patients/patient-1",
    "/api/patients/patient-1/bilans",
    "/api/bilans/bilan-1",
    "/api/bilans/bilan-1/export.docx",
    "/api/utilisateurs",
    "/api/etablissement",
    "/api/etablissement/quota",
    "/api/etablissement/audit",
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
