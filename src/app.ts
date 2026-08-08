import path from "node:path";
import express from "express";
import { pool } from "./db";
import {
  authentifier,
  exigerAuthentification,
  protegerCsrf,
} from "./middleware/authentification";
import { journalRequetes } from "./middleware/journalRequetes";
import { assistanceRouter } from "./routes/assistance";
import { authRouter } from "./routes/auth";
import { bilansRouter } from "./routes/bilans";
import { etablissementsRouter } from "./routes/etablissements";
import { patientsRouter } from "./routes/patients";
import { schemaRouter } from "./routes/schema";
import { utilisateursRouter } from "./routes/utilisateurs";

export function createApp() {
  const app = express();

  // Render et tout hébergeur derrière un répartiteur : sans cela, l'adresse
  // vue par l'application est celle du proxy, et le cookie `secure` ne serait
  // pas reconnu comme légitime.
  app.set("trust proxy", 1);
  app.disable("x-powered-by");

  app.use(express.json({ limit: "1mb" }));
  app.use(journalRequetes);

  // En-têtes de sécurité, posés à la main plutôt qu'avec une dépendance : ils
  // tiennent en dix lignes et une bibliothèque de plus est une surface de plus.
  app.use((_req, res, next) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader("Referrer-Policy", "same-origin");
    // Tout vient de notre origine : ni CDN, ni script distant. La transcription
    // charge son moteur WebAssembly et ses poids depuis des tiers, d'où les
    // exceptions ciblées sur `connect-src` et `worker-src`.
    res.setHeader(
      "Content-Security-Policy",
      [
        "default-src 'self'",
        "img-src 'self' data:",
        "style-src 'self' 'unsafe-inline'",
        "script-src 'self' 'wasm-unsafe-eval'",
        "worker-src 'self' blob:",
        "connect-src 'self' https://huggingface.co https://cdn.jsdelivr.net",
        "frame-ancestors 'none'",
        "base-uri 'self'",
        "form-action 'self'",
      ].join("; ")
    );
    next();
  });

  // Sonde de vivacité (aucune authentification requise) : utilisée par
  // l'hébergeur pour savoir si l'instance répond, et pour vérifier que la
  // base est joignable avant de router du trafic vers elle.
  app.get("/health", async (_req, res) => {
    try {
      await pool.query("SELECT 1");
      return res.json({ status: "ok", database: "ok" });
    } catch (err) {
      return res.status(503).json({
        status: "degraded",
        database: "unreachable",
        details: err instanceof Error ? err.message : String(err),
      });
    }
  });

  app.use(express.static(path.join(__dirname, "..", "public")));

  // Ordre déterminant. `authentifier` résout la session pour tout le monde ;
  // `protegerCsrf` s'applique à toute écriture, y compris la connexion ; puis
  // les routes d'authentification, seules accessibles sans session. Tout ce
  // qui suit `exigerAuthentification` est fermé — c'est une liste
  // d'autorisations, pas une liste d'exclusions : une route ajoutée plus bas
  // est protégée par défaut, ce qui est le bon sens de l'oubli.
  app.use(authentifier);
  app.use(protegerCsrf);
  app.use(authRouter);
  app.use("/api", exigerAuthentification);

  app.use(schemaRouter);
  app.use(assistanceRouter);
  app.use(etablissementsRouter);
  app.use(patientsRouter);
  app.use(utilisateursRouter);
  app.use(bilansRouter);

  // Filet de sécurité : une exception non rattrapée dans une route asynchrone
  // ne doit ni exposer de trace d'exécution, ni laisser la requête pendante.
  app.use(
    (
      err: unknown,
      _req: express.Request,
      res: express.Response,
      _next: express.NextFunction
    ) => {
      // eslint-disable-next-line no-console
      console.error("[erreur non rattrapée]", err);
      if (res.headersSent) {
        return;
      }
      res.status(500).json({ error: "Erreur interne" });
    }
  );

  return app;
}
