import { creerRouteur } from "../routeurAsync";
import { z } from "zod";
import {
  reformulerCommentaire,
  ReformulationError,
} from "../services/reformulationService";
import { limiter } from "../middleware/limitation";
import { journaliser } from "../services/auditService";
import { adresseIp, libelle } from "../middleware/authentification";

export const assistanceRouter = creerRouteur();

/**
 * Plafond large : un bilan de répit compte une douzaine de zones, et on peut
 * reformuler plusieurs fois la même. Cent appels par heure laissent travailler
 * sans contrainte perceptible tout en bornant la casse si un compte est
 * compromis ou si une boucle d'interface s'emballe.
 */
const LIMITE_REFORMULATION = limiter({
  maximum: 100,
  fenetreMinutes: 60,
  intitule: "la reformulation",
});

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
assistanceRouter.post(
  "/api/assistance/reformulation",
  LIMITE_REFORMULATION,
  async (req, res) => {
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

    // Le texte lui-même n'est pas journalisé : ce serait recopier une donnée
    // de santé dans une seconde table, et le journal doit rester consultable
    // par un coordinateur sans lui donner accès au contenu des bilans.
    await journaliser({
      action: "reformulation",
      utilisateurId: req.utilisateur!.id,
      utilisateurLibelle: libelle(req.utilisateur!),
      etablissementId: req.utilisateur!.etablissement_id,
      details: { intitule: parsed.data.intitule ?? null },
      adresseIp: adresseIp(req),
    });

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
  }
);
