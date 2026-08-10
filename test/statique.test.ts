import { mkdtemp, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import express from "express";
import request from "supertest";
import { describe, it, expect, beforeAll } from "vitest";
import { statiqueCompresse } from "../src/middleware/statique";

/**
 * Le middleware sert les fichiers de `public/`. Les tests travaillent sur un
 * dossier temporaire : ils vérifient un comportement, pas le contenu réel de
 * l'interface, qui bouge à chaque évolution de l'écran.
 */
let racine: string;
let app: express.Express;

const CSS = ".a{color:red}".repeat(200); // ~2,6 Kio, largement compressible

beforeAll(async () => {
  racine = await mkdtemp(path.join(tmpdir(), "statique-"));
  await writeFile(path.join(racine, "style.css"), CSS);
  await writeFile(path.join(racine, "secret.bin"), "binaire");
  await writeFile(path.join(racine, "index.html"), "<p>page</p>".repeat(100));
  await mkdir(path.join(racine, "vendor"), { recursive: true });
  await writeFile(path.join(racine, "vendor", "lib.js"), "export const a = 1;");
  await writeFile(path.join(path.dirname(racine), "hors-racine.css"), "vole");

  app = express();
  app.use(statiqueCompresse(racine));
  app.use((_req, res) => res.status(404).end());
});

describe("service des fichiers statiques", () => {
  it("compresse en brotli quand le navigateur l'accepte", async () => {
    const res = await request(app)
      .get("/style.css")
      .set("Accept-Encoding", "br")
      .buffer()
      .parse((r, cb) => {
        const morceaux: Buffer[] = [];
        r.on("data", (m: Buffer) => morceaux.push(m));
        r.on("end", () => cb(null, Buffer.concat(morceaux)));
      });

    expect(res.status).toBe(200);
    expect(res.headers["content-encoding"]).toBe("br");
    expect(res.headers["content-type"]).toContain("text/css");
    expect(Number(res.headers["content-length"])).toBeLessThan(CSS.length / 4);
  });

  it("sert le fichier tel quel à un client qui ne compresse pas", async () => {
    const res = await request(app).get("/style.css").set("Accept-Encoding", "");

    expect(res.status).toBe(200);
    expect(res.headers["content-encoding"]).toBeUndefined();
    expect(res.text).toBe(CSS);
  });

  it("annonce Vary pour qu'un intermédiaire ne mélange pas les encodages", async () => {
    const res = await request(app).get("/style.css").set("Accept-Encoding", "gzip");
    expect(res.headers.vary).toBe("Accept-Encoding");
    expect(res.headers["content-encoding"]).toBe("gzip");
  });

  it("répond 304 à une revalidation, sans renvoyer le corps", async () => {
    const premiere = await request(app).get("/style.css").set("Accept-Encoding", "br");
    const seconde = await request(app)
      .get("/style.css")
      .set("Accept-Encoding", "br")
      .set("If-None-Match", premiere.headers.etag);

    expect(seconde.status).toBe(304);
    expect(seconde.text).toBeFalsy();
  });

  it("donne un ETag différent à chaque encodage du même fichier", async () => {
    // Sinon un cache partagé pourrait servir du brotli à un client qui n'en
    // veut pas, à partir d'une entrée validée pour un autre encodage.
    const brotli = await request(app).get("/style.css").set("Accept-Encoding", "br");
    const gzip = await request(app).get("/style.css").set("Accept-Encoding", "gzip");

    expect(brotli.headers.etag).not.toBe(gzip.headers.etag);
  });

  it("fait revalider l'interface à chaque chargement", async () => {
    // Un correctif déployé doit arriver au poste de l'éducateur sans qu'il ait
    // à vider son cache.
    const res = await request(app).get("/style.css");
    expect(res.headers["cache-control"]).toBe("public, max-age=0, must-revalidate");
  });

  it("garde en revanche la bibliothèque figée un an", async () => {
    const res = await request(app).get("/vendor/lib.js");
    expect(res.headers["cache-control"]).toContain("immutable");
  });

  it("compresse aussi la page elle-même, demandée sans nom de fichier", async () => {
    const res = await request(app).get("/").set("Accept-Encoding", "br");

    expect(res.status).toBe(200);
    expect(res.headers["content-encoding"]).toBe("br");
    expect(res.headers["content-type"]).toContain("text/html");
  });

  it("laisse passer ce qu'il ne sait pas servir", async () => {
    // Les binaires retombent sur `express.static`, placé derrière : ici, le
    // 404 de secours.
    const res = await request(app).get("/secret.bin");
    expect(res.status).toBe(404);
  });

  it("ne sort pas de la racine, même avec un chemin encodé", async () => {
    for (const chemin of [
      "/../hors-racine.css",
      "/%2e%2e/hors-racine.css",
      "/%2e%2e%2fhors-racine.css",
    ]) {
      const res = await request(app).get(chemin);
      expect(res.status).toBe(404);
    }
  });
});
