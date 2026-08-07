import { Router } from "express";
import { z } from "zod";
import {
  reformulerCommentaire,
  ReformulationError,
} from "../services/reformulationService";

export const assistanceRouter = Router();

const ReformulationBodySchema = z.object({
  texte: z.string(),
  /** Intitulé de la zone, donné au moteur comme contexte de rédaction. */
  intitule: z.string().optional(),
});

/**
 * Mise au propre d'un commentaire dicté, dans les parcours guidés.
 *
 * Volontairement hors du quota mensuel : celui-ci compte des bilans, pas des
 * appels. Un bilan de répit comporte une douzaine de zones de commentaire ;
 * les décompter une à une viderait le quota d'un établissement en trois
 * bilans, pour une facturation qui n'a pas ce sens.
 *
 * La réponse ne remplace jamais le texte d'origine côté serveur : elle est
 * proposée à l'éducateur, qui la garde ou l'annule.
 */
assistanceRouter.post("/api/assistance/reformulation", async (req, res) => {
  const parsed = ReformulationBodySchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({
      error: "Requête invalide",
      details: parsed.error.flatten(),
    });
  }

  try {
    const texte = await reformulerCommentaire(
      parsed.data.texte,
      parsed.data.intitule
    );
    return res.json({ texte });
  } catch (err) {
    if (err instanceof ReformulationError) {
      return res.status(400).json({ error: err.message });
    }
    // eslint-disable-next-line no-console
    console.error(err);
    return res.status(502).json({
      error: "La reformulation a échoué. Votre texte n'a pas été modifié.",
    });
  }
});
