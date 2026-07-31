import path from "node:path";
import express from "express";
import { bilansRouter } from "./routes/bilans";
import { patientsRouter } from "./routes/patients";
import { utilisateursRouter } from "./routes/utilisateurs";

export function createApp() {
  const app = express();
  app.use(express.json());
  app.use(express.static(path.join(__dirname, "..", "public")));
  app.use(patientsRouter);
  app.use(utilisateursRouter);
  app.use(bilansRouter);
  return app;
}
