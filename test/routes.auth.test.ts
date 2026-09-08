import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";

vi.mock("../src/repositories/utilisateurRepository", () => ({
  aucunCompteUtilisable: vi.fn(),
  creerUtilisateur: vi.fn(),
  getUtilisateurParEmail: vi.fn(),
  marquerConnexion: vi.fn(),
  changerMotDePasse: vi.fn(),
  listUtilisateurs: vi.fn(),
  getUtilisateurById: vi.fn(),
  desactiverUtilisateur: vi.fn(),
}));

vi.mock("../src/repositories/etablissementRepository", () => ({
  listerEtablissementsAvecEffectif: vi.fn(),
  creerEtablissement: vi.fn(),
  getEtablissementById: vi.fn(),
  mettreAJourEtablissement: vi.fn(),
}));

vi.mock("../src/services/auditService", () => ({
  journaliser: vi.fn(),
  listerAudit: vi.fn(),
}));

vi.mock("../src/services/sessionService", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/services/sessionService")>()),
  ouvrirSession: vi.fn().mockResolvedValue({
    jeton: "jeton",
    expireLe: new Date(Date.now() + 3600_000),
  }),
  resoudreSession: vi.fn().mockResolvedValue(null),
  prolongerSession: vi.fn(),
  fermerSessionsDe: vi.fn(),
}));

import {
  aucunCompteUtilisable,
  creerUtilisateur,
} from "../src/repositories/utilisateurRepository";
import {
  creerEtablissement,
  listerEtablissementsAvecEffectif,
  mettreAJourEtablissement,
} from "../src/repositories/etablissementRepository";
import { createApp } from "../src/app";

const app = createApp();

/** Un établissement tel que le renvoie le recensement, effectif compris. */
function etablissement(nom: string, id: string, nombre_beneficiaires: number) {
  return {
    id,
    nom,
    adresse: "",
    telephone: "",
    email: "",
    quota_mensuel_bilans: 50,
    nombre_beneficiaires,
  };
}

/** Ce que sème la migration 004 sur toute base, neuve comprise. */
const SEMEE = etablissement(
  "Établissement par défaut",
  "00000000-0000-0000-0000-000000000001",
  0
);

const CORPS_VALIDE = {
  nom: "Dubois",
  prenom: "Marie",
  email: "marie@exemple.fr",
  mot_de_passe: "phrase de passe robuste 2026",
};

function miseEnService(corps: Record<string, unknown>) {
  return request(app)
    .post("/api/auth/initialisation")
    .set("x-outils-educsp", "1")
    .send(corps);
}

describe("mise en service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(creerUtilisateur).mockResolvedValue({
      id: "u1",
      nom: "Dubois",
      prenom: "Marie",
      email: "marie@exemple.fr",
      role: "admin",
      etablissement_id: "etab-1",
      actif: true,
    });
    vi.mocked(creerEtablissement).mockResolvedValue({ id: "etab-1" });
  });

  it("est fermée dès qu'un compte peut se connecter", async () => {
    vi.mocked(aucunCompteUtilisable).mockResolvedValue(false);

    const res = await miseEnService({ ...CORPS_VALIDE, etablissement: "PCPE" });

    expect(res.status).toBe(409);
    expect(creerUtilisateur).not.toHaveBeenCalled();
  });

  it("refuse un mot de passe trop court, sans rien créer", async () => {
    vi.mocked(aucunCompteUtilisable).mockResolvedValue(true);
    vi.mocked(listerEtablissementsAvecEffectif).mockResolvedValue([]);

    const res = await miseEnService({
      ...CORPS_VALIDE,
      etablissement: "PCPE",
      mot_de_passe: "court",
    });

    expect(res.status).toBe(400);
    expect(creerEtablissement).not.toHaveBeenCalled();
    expect(creerUtilisateur).not.toHaveBeenCalled();
  });

  it("crée l'établissement sur une base vierge", async () => {
    vi.mocked(aucunCompteUtilisable).mockResolvedValue(true);
    vi.mocked(listerEtablissementsAvecEffectif).mockResolvedValue([]);

    const res = await miseEnService({ ...CORPS_VALIDE, etablissement: "PCPE" });

    expect(res.status).toBe(201);
    expect(creerEtablissement).toHaveBeenCalledWith("PCPE", undefined);
  });

  /**
   * Cas d'une instance mise à jour depuis une version sans authentification :
   * l'établissement et ses bénéficiaires existent, mais aucun compte n'a de
   * mot de passe. En créer un second rendrait ces données invisibles au
   * premier compte, qui n'y serait pas rattaché.
   */
  it("se rattache à l'établissement existant plutôt que d'en ouvrir un second", async () => {
    vi.mocked(aucunCompteUtilisable).mockResolvedValue(true);
    vi.mocked(listerEtablissementsAvecEffectif).mockResolvedValue([
      etablissement("PCPE Transitions", "etab-existant", 12),
    ]);

    const res = await miseEnService(CORPS_VALIDE);

    expect(res.status).toBe(201);
    expect(creerEtablissement).not.toHaveBeenCalled();
    expect(creerUtilisateur).toHaveBeenCalledWith(
      expect.objectContaining({ etablissementId: "etab-existant", role: "admin" })
    );
  });

  it("annonce l'établissement existant pour que le formulaire ne le redemande pas", async () => {
    vi.mocked(aucunCompteUtilisable).mockResolvedValue(true);
    vi.mocked(listerEtablissementsAvecEffectif).mockResolvedValue([
      etablissement("PCPE Transitions", "etab-existant", 12),
    ]);

    const res = await request(app).get("/api/auth/etat");

    expect(res.body).toMatchObject({
      initialise: false,
      etablissement_existant: { id: "etab-existant", nom: "PCPE Transitions" },
    });
  });

  /**
   * La migration 004 sème un « Établissement par défaut » sur toute base, y
   * compris neuve. Le prendre pour une structure réelle ferait taire la
   * question du nom au premier démarrage, et rattacherait silencieusement le
   * premier compte à un établissement qui n'existe pas.
   */
  it("ne présente pas l'établissement semé, vide, comme un établissement existant", async () => {
    vi.mocked(aucunCompteUtilisable).mockResolvedValue(true);
    vi.mocked(listerEtablissementsAvecEffectif).mockResolvedValue([SEMEE]);

    const res = await request(app).get("/api/auth/etat");

    expect(res.body).toMatchObject({
      initialise: false,
      etablissement_existant: null,
    });
  });

  it("renomme l'établissement semé plutôt que d'en créer un second à côté", async () => {
    vi.mocked(aucunCompteUtilisable).mockResolvedValue(true);
    vi.mocked(listerEtablissementsAvecEffectif).mockResolvedValue([SEMEE]);

    const res = await miseEnService({ ...CORPS_VALIDE, etablissement: "PCPE" });

    expect(res.status).toBe(201);
    expect(creerEtablissement).not.toHaveBeenCalled();
    expect(mettreAJourEtablissement).toHaveBeenCalledWith(
      SEMEE.id,
      expect.objectContaining({ nom: "PCPE" })
    );
    expect(creerUtilisateur).toHaveBeenCalledWith(
      expect.objectContaining({ etablissementId: SEMEE.id })
    );
  });

  it("exige quand même le nom quand le seul établissement est celui semé", async () => {
    vi.mocked(aucunCompteUtilisable).mockResolvedValue(true);
    vi.mocked(listerEtablissementsAvecEffectif).mockResolvedValue([SEMEE]);

    const res = await miseEnService(CORPS_VALIDE);

    expect(res.status).toBe(400);
    expect(creerUtilisateur).not.toHaveBeenCalled();
    expect(mettreAJourEtablissement).not.toHaveBeenCalled();
  });

  it("exige un nom d'établissement quand il n'y en a aucun", async () => {
    vi.mocked(aucunCompteUtilisable).mockResolvedValue(true);
    vi.mocked(listerEtablissementsAvecEffectif).mockResolvedValue([]);

    const res = await miseEnService(CORPS_VALIDE);

    expect(res.status).toBe(400);
    expect(creerUtilisateur).not.toHaveBeenCalled();
  });
});
