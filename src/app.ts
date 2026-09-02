import { readFileSync } from "node:fs";
import path from "node:path";
import express from "express";
import { racineProjet } from "./chemins";
import { config } from "./config";
import { pool } from "./db";
import { baseInjoignable } from "./erreursBase";
import {
  authentifier,
  exigerAuthentification,
  protegerCsrf,
} from "./middleware/authentification";
import { journalRequetes } from "./middleware/journalRequetes";
import { statiqueCompresse } from "./middleware/statique";
import { POLITIQUE_CSP } from "./securite/csp";
import { amorcageRouter } from "./routes/amorcage";
import { assistanceRouter } from "./routes/assistance";
import { authRouter } from "./routes/auth";
import { bilansRouter } from "./routes/bilans";
import { etablissementsRouter } from "./routes/etablissements";
import { patientsRouter } from "./routes/patients";
import { schemaRouter } from "./routes/schema";
import { utilisateursRouter } from "./routes/utilisateurs";

/**
 * Version publiée, lue une fois au démarrage.
 *
 * Sans elle, la première question de tout incident — « quelle version tourne
 * sur ce poste ? » — n'a pas de réponse, et l'on répare parfois ce qui l'est
 * déjà.
 */
let version: string | null = null;
function versionApplication(): string {
  if (version === null) {
    try {
      const paquet = JSON.parse(
        readFileSync(path.join(racineProjet(__dirname), "package.json"), "utf8")
      );
      version = String(paquet.version ?? "inconnue");
    } catch {
      version = "inconnue";
    }
  }
  return version;
}

export function createApp() {
  const app = express();

  // Render et tout hébergeur derrière un répartiteur : sans cela, l'adresse
  // vue par l'application est celle du proxy, et le cookie `secure` ne serait
  // pas reconnu comme légitime.
  app.set("trust proxy", 1);
  app.disable("x-powered-by");

  app.use(express.json({ limit: "1mb" }));
  app.use(journalRequetes);

  /**
   * HTTPS obligatoire en production.
   *
   * Le cookie de session porte déjà l'attribut `secure`, qui empêche le
   * navigateur de l'émettre en clair — mais il ne l'empêche pas d'envoyer un
   * mot de passe sur une page servie en HTTP. D'où deux verrous :
   *
   *  - toute requête arrivée en clair est renvoyée en 308 vers son équivalent
   *    chiffré, avant d'atteindre la moindre route ;
   *  - `Strict-Transport-Security` demande au navigateur de refuser lui-même
   *    le HTTP sur ce domaine pendant un an, ce qui ferme la fenêtre du tout
   *    premier appel, le seul que la redirection ne protège pas.
   *
   * `includeSubDomains` est volontairement absent : sur un domaine
   * d'établissement, il imposerait HTTPS à des sous-domaines qui ne nous
   * appartiennent pas. `preload` l'est aussi — il est irréversible.
   */
  if (config.env === "production") {
    app.use((req, res, next) => {
      // `req.secure` tient compte de `trust proxy` : derrière Render, il
      // reflète `x-forwarded-proto`, pas la connexion locale au conteneur.
      //
      // `/health` est la seule exception. L'hébergeur interroge la sonde
      // depuis l'intérieur du conteneur, souvent sans `x-forwarded-proto` :
      // la redirection serait lue comme une instance en panne et le
      // déploiement échouerait. Elle ne transporte ni identifiant ni donnée.
      if (req.path !== "/health" && !req.secure) {
        return res.redirect(308, `https://${req.header("host")}${req.originalUrl}`);
      }
      if (req.secure) {
        res.setHeader("Strict-Transport-Security", "max-age=31536000");
      }
      return next();
    });
  }

  // En-têtes de sécurité, posés à la main plutôt qu'avec une dépendance : ils
  // tiennent en dix lignes et une bibliothèque de plus est une surface de plus.
  app.use((_req, res, next) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader("Referrer-Policy", "same-origin");
    // Tout vient de notre origine, à l'exception de ce dont la dictée vocale a
    // besoin. Chaque entrée est justifiée dans `securite/csp.ts` — s'y référer
    // avant d'en ajouter ou d'en retirer une.
    res.setHeader("Content-Security-Policy", POLITIQUE_CSP);
    next();
  });

  /**
   * Sonde de vivacité (aucune authentification requise).
   *
   * Elle répond 200 dès lors que ce processus répond, y compris quand la base
   * est injoignable — et le corps le dit alors sans détour. Ce n'est pas une
   * complaisance : l'hébergeur ne dispose que de cette sonde pour décider si
   * l'instance mérite de vivre, et un 503 la ferait rejeter au déploiement.
   * On perdrait exactement ce qui sert à comprendre la panne : cette page,
   * `/diagnostic.html`, et la reprise automatique des migrations quand la base
   * revient. Une base absente est une panne de l'environnement, pas de
   * l'instance ; c'est à `status` de le dire, pas au code HTTP.
   */
  app.get("/health", async (_req, res) => {
    try {
      await pool.query("SELECT 1");
      return res.json({ status: "ok", database: "ok", version: versionApplication() });
    } catch (err) {
      return res.json({
        status: "degraded",
        database: "unreachable",
        version: versionApplication(),
        details: err instanceof Error ? err.message : String(err),
      });
    }
  });

  // Les fichiers texte passent par le middleware de compression ; tout le
  // reste (images, polices locales, binaires) retombe sur `express.static`.
  const dossierPublic = path.join(racineProjet(__dirname), "public");
  app.use(statiqueCompresse(dossierPublic));
  app.use(express.static(dossierPublic));

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
  app.use(amorcageRouter);
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
      // Une base injoignable n'est pas une erreur interne : l'application va
      // bien, c'est sa base qui manque. Le dire évite de chercher un défaut
      // dans le code, et 503 indique — au navigateur comme à l'hébergeur —
      // une indisponibilité passagère plutôt qu'une requête fautive.
      if (baseInjoignable(err)) {
        return res.status(503).json({
          error:
            "La base de données est injoignable : rien ne peut être lu ni " +
            "enregistré pour le moment. Ouvrez /diagnostic.html pour un état " +
            "détaillé ; la correction est côté serveur.",
        });
      }
      res.status(500).json({ error: "Erreur interne" });
    }
  );

  return app;
}
