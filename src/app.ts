import path from "node:path";
import express from "express";
import { pool } from "./db";
import { assistanceRouter } from "./routes/assistance";
import { bilansRouter } from "./routes/bilans";
import { etablissementsRouter } from "./routes/etablissements";
import { patientsRouter } from "./routes/patients";
import { schemaRouter } from "./routes/schema";
import { utilisateursRouter } from "./routes/utilisateurs";

export function createApp() {
  const app = express();
  app.use(express.json());

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
  app.use(schemaRouter);
  app.use(assistanceRouter);
  app.use(etablissementsRouter);
  app.use(patientsRouter);
  app.use(utilisateursRouter);
  app.use(bilansRouter);
  return app;
}
