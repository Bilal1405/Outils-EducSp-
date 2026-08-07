import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";

vi.mock("../src/repositories/patientRepository", () => ({
  getPatientById: vi.fn(),
}));

vi.mock("../src/repositories/bilanRepository", () => ({
  getDernierBilanValide: vi.fn(),
  creerBilanBrouillon: vi.fn(),
  getBilanById: vi.fn(),
  getBilanAvecBeneficiaire: vi.fn(),
  updateBilan: vi.fn(),
  listBilansForPatient: vi.fn(),
}));

vi.mock("../src/services/quotaService", () => ({
  getQuotaStatus: vi.fn(),
  decrementerQuota: vi.fn(),
}));

vi.mock("../src/services/llmClient", () => ({
  chatComplete: vi.fn(),
}));

import { getPatientById } from "../src/repositories/patientRepository";
import {
  getDernierBilanValide,
  creerBilanBrouillon,
  getBilanById,
  updateBilan,
} from "../src/repositories/bilanRepository";
import { getQuotaStatus, decrementerQuota } from "../src/services/quotaService";
import { chatComplete } from "../src/services/llmClient";
import { createApp } from "../src/app";
import { validBilanFixture } from "./fixtures/bilanFixture";

const app = createApp();

const mockedGetPatientById = vi.mocked(getPatientById);
const mockedGetDernierBilanValide = vi.mocked(getDernierBilanValide);
const mockedCreerBilanBrouillon = vi.mocked(creerBilanBrouillon);
const mockedGetBilanById = vi.mocked(getBilanById);
const mockedUpdateBilan = vi.mocked(updateBilan);
const mockedGetQuotaStatus = vi.mocked(getQuotaStatus);
const mockedDecrementerQuota = vi.mocked(decrementerQuota);
const mockedChatComplete = vi.mocked(chatComplete);

const patientFixture = {
  id: "patient-1",
  nom: "Dupont",
  prenom: "Alice",
  date_naissance: null,
  etablissement_id: "etab-1",
};

const quotaDisponible = {
  etablissement_id: "etab-1",
  mois: "2026-07-01",
  quota_mensuel: 50,
  consomme: 3,
  restant: 47,
};

const bilanDetailFixture = {
  id: "bilan-1",
  patient_id: "patient-1",
  etablissement_id: "etab-1",
  auteur_id: "auteur-1",
  date_generation: "2026-07-01T00:00:00.000Z",
  type_bilan: "bilan" as const,
  periode_debut: "2024-01-01",
  periode_fin: "2024-03-31",
  statut: "brouillon" as const,
  source: "texte" as const,
  bilan_precedent_id: null,
  contenu: validBilanFixture,
};

// §9 : cas de recette imposés, entièrement mockés (repositories + moteur
// IA) — aucun réseau ni base de données réelle requis.
describe("POST /api/patients/:id/bilans/generate", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedGetPatientById.mockResolvedValue(patientFixture);
    mockedGetDernierBilanValide.mockResolvedValue(null);
    mockedGetQuotaStatus.mockResolvedValue(quotaDisponible);
    mockedDecrementerQuota.mockResolvedValue({
      ...quotaDisponible,
      consomme: 4,
      restant: 46,
    });
    mockedCreerBilanBrouillon.mockResolvedValue({ id: "bilan-1" });
    mockedChatComplete.mockResolvedValue(JSON.stringify(validBilanFixture));
  });

  it("cas 1 (§9) : compte-rendu texte complet → bilan JSON complet, décrémente le quota après sauvegarde", async () => {
    const res = await request(app)
      .post("/api/patients/patient-1/bilans/generate")
      .set("x-user-id", "auteur-1")
      .send({
        texte: "Compte-rendu couvrant les 7 domaines de compétence...",
        periode_debut: "2024-01-01",
        periode_fin: "2024-03-31",
      });

    expect(res.status).toBe(201);
    expect(res.body.contenu.en_tete.beneficiaire_nom).toBe(
      validBilanFixture.en_tete.beneficiaire_nom
    );
    expect(mockedCreerBilanBrouillon).toHaveBeenCalledTimes(1);
    expect(mockedDecrementerQuota).toHaveBeenCalledWith("etab-1", 50);

    // Le quota renvoyé au client vient du décrément lui-même : la table n'est
    // pas relue après écriture.
    expect(res.body.quota).toMatchObject({ consomme: 4, restant: 46 });
    expect(mockedGetQuotaStatus).toHaveBeenCalledTimes(1);

    // Ordre imposé §2 : décrément quota après enregistrement, pas avant.
    const creerOrder = mockedCreerBilanBrouillon.mock.invocationCallOrder[0];
    const decrementOrder = mockedDecrementerQuota.mock.invocationCallOrder[0];
    expect(creerOrder).toBeLessThan(decrementOrder);
  });

  it("cas 2 (§9) : bilan N-1 existant → contexte injecté et bilan_precedent_id tracé (BIL-03, G3)", async () => {
    mockedGetDernierBilanValide.mockResolvedValue({
      id: "bilan-precedent-1",
      contenu: validBilanFixture,
    });

    const res = await request(app)
      .post("/api/patients/patient-1/bilans/generate")
      .set("x-user-id", "auteur-1")
      .send({
        texte: "Compte-rendu de suivi de la période...",
        periode_debut: "2024-04-01",
        periode_fin: "2024-06-30",
      });

    expect(res.status).toBe(201);

    const [messages] = mockedChatComplete.mock.calls[0];
    const userMessage = messages.find((m) => m.role === "user");
    expect(userMessage?.content).toContain("bilan précédent");

    expect(mockedCreerBilanBrouillon).toHaveBeenCalledWith(
      expect.objectContaining({ bilanPrecedentId: "bilan-precedent-1" })
    );
  });

  it("trace l'origine dictée du compte-rendu sans jamais recevoir d'audio", async () => {
    const res = await request(app)
      .post("/api/patients/patient-1/bilans/generate")
      .set("x-user-id", "auteur-1")
      .send({
        texte: "Transcription produite dans le navigateur…",
        source: "audio",
        periode_debut: "2024-01-01",
        periode_fin: "2024-03-31",
      });

    expect(res.status).toBe(201);
    expect(mockedCreerBilanBrouillon).toHaveBeenCalledWith(
      expect.objectContaining({ source: "audio" })
    );
  });

  it("classe le compte-rendu en source texte par défaut", async () => {
    await request(app)
      .post("/api/patients/patient-1/bilans/generate")
      .set("x-user-id", "auteur-1")
      .send({
        texte: "Compte-rendu saisi au clavier",
        periode_debut: "2024-01-01",
        periode_fin: "2024-03-31",
      });

    expect(mockedCreerBilanBrouillon).toHaveBeenCalledWith(
      expect.objectContaining({ source: "texte" })
    );
  });

  it("cas 3 (§9) : compte-rendu vide/insuffisant → alerte bloquante, aucune génération (BIL-04, G1, G2)", async () => {
    const res = await request(app)
      .post("/api/patients/patient-1/bilans/generate")
      .set("x-user-id", "auteur-1")
      .send({
        texte: "   ",
        periode_debut: "2024-01-01",
        periode_fin: "2024-03-31",
      });

    expect(res.status).toBe(400);
    expect(mockedChatComplete).not.toHaveBeenCalled();
    expect(mockedCreerBilanBrouillon).not.toHaveBeenCalled();
  });

  it("QUOTA-01 : quota épuisé → alerte bloquante (429), aucun appel au moteur IA", async () => {
    mockedGetQuotaStatus.mockResolvedValue({
      ...quotaDisponible,
      consomme: 50,
      restant: 0,
    });

    const res = await request(app)
      .post("/api/patients/patient-1/bilans/generate")
      .set("x-user-id", "auteur-1")
      .send({
        texte: "Compte-rendu...",
        periode_debut: "2024-01-01",
        periode_fin: "2024-03-31",
      });

    expect(res.status).toBe(429);
    expect(mockedChatComplete).not.toHaveBeenCalled();
    expect(mockedCreerBilanBrouillon).not.toHaveBeenCalled();
    expect(mockedDecrementerQuota).not.toHaveBeenCalled();
  });

  it("404 si le patient n'existe pas", async () => {
    mockedGetPatientById.mockResolvedValue(null);

    const res = await request(app)
      .post("/api/patients/inconnu/bilans/generate")
      .set("x-user-id", "auteur-1")
      .send({ texte: "x", periode_debut: "2024-01-01", periode_fin: "2024-03-31" });

    expect(res.status).toBe(404);
  });

  it("401 si l'en-tête x-user-id (auteur) est absent", async () => {
    const res = await request(app)
      .post("/api/patients/patient-1/bilans/generate")
      .send({ texte: "x", periode_debut: "2024-01-01", periode_fin: "2024-03-31" });

    expect(res.status).toBe(401);
    expect(mockedChatComplete).not.toHaveBeenCalled();
  });
});

// Invariant §9 : un bilan validé est archivé définitivement, non modifiable.
describe("PATCH /api/bilans/:id", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("refuse toute modification d'un bilan déjà validé (409, immutabilité)", async () => {
    mockedGetBilanById.mockResolvedValue({ ...bilanDetailFixture, statut: "validé" });

    const res = await request(app)
      .patch("/api/bilans/bilan-1")
      .send({ statut: "validé" });

    expect(res.status).toBe(409);
    expect(mockedUpdateBilan).not.toHaveBeenCalled();
  });

  it("autorise l'édition d'un brouillon et sa validation", async () => {
    mockedGetBilanById.mockResolvedValue(bilanDetailFixture);
    mockedUpdateBilan.mockResolvedValue({ ...bilanDetailFixture, statut: "validé" });

    const res = await request(app)
      .patch("/api/bilans/bilan-1")
      .send({ statut: "validé" });

    expect(res.status).toBe(200);
    expect(res.body.statut).toBe("validé");
    expect(mockedUpdateBilan).toHaveBeenCalledWith("bilan-1", { statut: "validé" });
  });

  it("404 si le bilan n'existe pas", async () => {
    mockedGetBilanById.mockResolvedValue(null);

    const res = await request(app)
      .patch("/api/bilans/inconnu")
      .send({ statut: "validé" });

    expect(res.status).toBe(404);
  });
});
