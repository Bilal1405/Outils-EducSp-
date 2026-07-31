import express from "express";
import { bilansRouter } from "./routes/bilans";

export function createApp() {
  const app = express();
  app.use(express.json());
  app.use(bilansRouter);
  return app;
}
