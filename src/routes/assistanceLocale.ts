import { z } from "zod";
import { creerRouteur } from "../routeurAsync";
import { exigerCleActivation } from "../middleware/cleActivation";
import { limiter } from "../middleware/limitation";
import { generateBilan, BilanGenerationError } from "../services/bilanGenerator";
import {
  reformulerCommentaire,
  ReformulationError,
} from "../services/reformulationService";

/**
 * Les deux seules routes que l'application installée sur un téléphone appelle.
 *
 * La version pour praticien indépendant tient ses dossiers sur l'appareil et
 * n'a pas de serveur — c'est ce qui la dispense d'hébergeur agréé. Un modèle de
 * langage, lui, ne tient pas dans un téléphone. Ces deux routes sont donc le
 * seul point par lequel quelque chose sort de l'appareil, et elles sont écrites
 * pour être aussi étroites que possible :
 *
 *  - **rien n'est écrit.** Ni bilan, ni brouillon, ni entrée de journal, ni
 *    compteur en base. Le document est rédigé dans l'appareil, à partir de ce
 *    que ces routes rendent. Un serveur qui ne garde rien n'a rien à perdre, et
 *    ces routes continuent de répondre même quand la base est injoignable ;
 *  - **rien n'est identifiant.** L'appareil masque les noms qu'il connaît avant
 *    d'envoyer, et remplit lui-même l'en-tête du bilan. Le modèle ne reçoit
 *    donc ni ne rend aucun nom — voir `public/js/local/masquage.js` ;
 *  - **rien n'est ouvert par défaut.** Sans clé d'activation configurée, la
 *    porte répond 503.
 *
 * Elles sont montées **avant** `app.use("/api", exigerAuthentification)`, sur
 * un préfixe qui se lit d'un coup d'œil. La fermeture générale de `/api` reste
 * une liste d'autorisations : on n'y ouvre pas d'exception, on met la porte à
 * côté.
 */
export const assistanceLocaleRouter = creerRouteur();

/**
 * Compté par clé d'activation, jamais globalement : un appareil ne doit pas
 * pouvoir vider le plafond des autres.
 *
 * Vingt rédactions par heure — le même plafond que la route authentifiée
 * (`src/routes/bilans.ts`) — et cent reformulations, un bilan de répit comptant
 * une douzaine de zones qu'on peut reprendre plusieurs fois.
 */
const identiteParCle = (req: { cleActivation?: string }) =>
  req.cleActivation ?? "sans-cle";

const LIMITE_REDACTION = limiter({
  maximum: 20,
  fenetreMinutes: 60,
  intitule: "la rédaction assistée",
  identite: identiteParCle,
});

const LIMITE_REFORMULATION = limiter({
  maximum: 100,
  fenetreMinutes: 60,
  intitule: "la reformulation",
  identite: identiteParCle,
});

/**
 * Le contexte du bilan antérieur se limite aux deux sections que le prompt lit
 * réellement. L'en-tête du document — donc le nom — n'a aucune raison de partir.
 */
const ContextePrecedentSchema = z.object({
  evaluation_objectifs_par_domaine: z.array(z.unknown()),
  proposition_objectifs_periode_suivante: z.array(z.unknown()),
});

const RedactionBodySchema = z.object({
  texte: z.string().min(1),
  precedent: ContextePrecedentSchema.optional(),
});

const ReformulationBodySchema = z.object({
  texte: z.string(),
  intitule: z.string().optional(),
});

assistanceLocaleRouter.post(
  "/api/local/redaction",
  exigerCleActivation,
  LIMITE_REDACTION,
  async (req, res) => {
    const parsed = RedactionBodySchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        error: "Requête invalide",
        details: parsed.error.flatten(),
      });
    }

    try {
      // Le contexte N-1 traverse tel quel : sa forme est déjà garantie par le
      // schéma de sortie du moteur, appliqué sur l'appareil au moment où le
      // bilan antérieur a été enregistré.
      const contenu = await generateBilan(
        parsed.data.texte,
        parsed.data.precedent as Parameters<typeof generateBilan>[1]
      );
      return res.json({ contenu });
    } catch (err) {
      if (err instanceof BilanGenerationError) {
        return res.status(502).json({
          error: "Échec de génération du bilan",
          details: err.message,
        });
      }
      // eslint-disable-next-line no-console
      console.error("[assistance locale] rédaction", err);
      return res.status(502).json({
        error: "La rédaction assistée a échoué. Votre compte-rendu est intact.",
      });
    }
  }
);

assistanceLocaleRouter.post(
  "/api/local/reformulation",
  exigerCleActivation,
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
      return res.json({ texte });
    } catch (err) {
      if (err instanceof ReformulationError) {
        return res.status(400).json({ error: err.message });
      }
      // eslint-disable-next-line no-console
      console.error("[assistance locale] reformulation", err);
      return res.status(502).json({
        error: "La reformulation a échoué. Votre texte n'a pas été modifié.",
      });
    }
  }
);
