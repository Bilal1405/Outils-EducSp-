import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import request from "supertest";

vi.mock("../src/repositories/utilisateurRepository", () => ({
  aucunCompteUtilisable: vi.fn().mockResolvedValue(false),
  getUtilisateurParEmail: vi.fn(),
  creerUtilisateur: vi.fn(),
  marquerConnexion: vi.fn(),
  changerMotDePasse: vi.fn(),
  listUtilisateurs: vi.fn(),
  getUtilisateurById: vi.fn(),
  desactiverUtilisateur: vi.fn(),
}));

vi.mock("../src/repositories/etablissementRepository", () => ({
  listerEtablissements: vi.fn().mockResolvedValue([]),
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
  resoudreSession: vi.fn().mockResolvedValue(null),
  prolongerSession: vi.fn(),
}));

/**
 * Le mode dépend de `config.env`, lu à l'import du module : chaque contexte
 * demande donc un module neuf, d'où `vi.resetModules` et un import dynamique.
 */
async function appPour(env: string) {
  vi.resetModules();
  process.env.NODE_ENV = env;
  const { createApp } = await import("../src/app");
  return createApp();
}

const envInitial = process.env.NODE_ENV;

describe("HTTPS en production", () => {
  beforeEach(() => {
    process.env.DATABASE_URL = "postgres://u:p@localhost:5432/t";
  });

  afterEach(() => {
    process.env.NODE_ENV = envInitial;
  });

  it("renvoie une requête en clair vers son équivalent chiffré", async () => {
    const app = await appPour("production");

    const res = await request(app)
      .get("/api/auth/etat")
      .set("X-Forwarded-Proto", "http")
      .set("Host", "bilans.exemple.fr");

    expect(res.status).toBe(308);
    expect(res.headers.location).toBe("https://bilans.exemple.fr/api/auth/etat");
  });

  it("conserve le chemin et la chaîne de requête dans la redirection", async () => {
    const app = await appPour("production");

    const res = await request(app)
      .get("/api/etablissement/audit?limite=50")
      .set("X-Forwarded-Proto", "http")
      .set("Host", "bilans.exemple.fr");

    expect(res.headers.location).toBe(
      "https://bilans.exemple.fr/api/etablissement/audit?limite=50"
    );
  });

  it("pose Strict-Transport-Security sur une requête déjà chiffrée", async () => {
    const app = await appPour("production");

    const res = await request(app)
      .get("/api/auth/etat")
      .set("X-Forwarded-Proto", "https");

    expect(res.status).toBe(200);
    expect(res.headers["strict-transport-security"]).toBe("max-age=31536000");
  });

  it("n'ajoute pas includeSubDomains ni preload", async () => {
    // Le premier imposerait HTTPS à des sous-domaines qui ne nous appartiennent
    // pas ; le second est irréversible.
    const app = await appPour("production");

    const res = await request(app)
      .get("/api/auth/etat")
      .set("X-Forwarded-Proto", "https");

    expect(res.headers["strict-transport-security"]).not.toContain("includeSubDomains");
    expect(res.headers["strict-transport-security"]).not.toContain("preload");
  });

  it("ne redirige ni ne verrouille en développement local", async () => {
    // Sans cela, `npm run dev` sur http://localhost deviendrait inutilisable,
    // et le navigateur mémoriserait le verrou pour un an.
    const app = await appPour("development");

    const res = await request(app).get("/api/auth/etat");

    expect(res.status).toBe(200);
    expect(res.headers["strict-transport-security"]).toBeUndefined();
  });
});
