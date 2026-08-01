import path from "node:path";
import express from "express";
import { audioRouter } from "./routes/audio";
import { bilansRouter } from "./routes/bilans";
import { etablissementsRouter } from "./routes/etablissements";
import { patientsRouter } from "./routes/patients";
import { utilisateursRouter } from "./routes/utilisateurs";

export function createApp() {
  const app = express();
  app.use(express.json());
  app.use(express.static(path.join(__dirname, "..", "public")));
  app.use(etablissementsRouter);
  app.use(patientsRouter);
  app.use(utilisateursRouter);
  app.use(bilansRouter);
  app.use(audioRouter);
  return app;
}
