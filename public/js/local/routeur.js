/**
 * Le serveur, rejoué dans le navigateur.
 *
 * L'interface parle au serveur par un point unique : `public/js/api.js`. En
 * donnant à ce point une seconde implémentation, de même surface et de mêmes
 * réponses, les 8 900 lignes d'interface existantes fonctionnent sans une
 * ligne de changement — écrans, parcours guidé, relecture, brouillons.
 *
 * Les requêtes SQL sont celles du serveur, recopiées de `src/repositories/`.
 * Ce n'est pas idéal — deux copies peuvent diverger — mais l'alternative
 * (compiler le serveur pour le navigateur) imposerait un empaqueteur à un
 * projet qui n'en a pas, et ferait entrer Express dans une page. Le prix est
 * assumé, et `test/routeurLocal.test.ts` borde ce qui peut l'être.
 *
 * Ce qui change délibérément par rapport au serveur, parce qu'un praticien
 * seul n'est pas un établissement :
 *
 *  - **pas de quota.** Il compte des bilans pour les facturer à un
 *    établissement ; ici il n'a personne à facturer. `null` fait disparaître
 *    la jauge de l'interface, plutôt que d'afficher une limite inventée ;
 *  - **pas d'équipe.** Un seul profil, créé à la mise en service ;
 *  - **pas de session.** Il n'y a pas de serveur à qui prouver son identité.
 *    La protection de l'appareil relève du verrouillage du téléphone — et
 *    d'un code d'application qui reste à écrire.
 */
import { ouvrirBase } from "./base.js";
import { contenuVierge } from "./contenuVierge.js";
import { SCHEMA_BILAN, MODELES_BILAN } from "./schema.js";
import { jetonsPoses, preparerEnvoi, restituer } from "./masquage.js";
import { ErreurAssistance, redigerBilan, reformuler } from "./assistance.js";
import { validerEnvoi } from "../apercuEnvoi.js";

/** Réponse d'une route locale, dans la forme qu'attend `api.js`. */
function reponse(statut, donnees = null) {
  return { statut, donnees };
}

function erreur(statut, message, details) {
  return reponse(statut, details ? { error: message, details } : { error: message });
}

/**
 * Ce que le serveur sait faire et pas encore la version locale.
 *
 * Un refus explicite, jamais un échec silencieux : l'utilisateur doit savoir
 * que la fonction existe mais n'est pas là, pas croire qu'il s'y prend mal.
 */
function pasEncore(quoi) {
  return erreur(
    501,
    `${quoi} n'est pas encore disponible dans la version pour praticien ` +
      `indépendant. Cette fonction existe dans la version en ligne.`
  );
}

// --- Profil local ------------------------------------------------------------

/**
 * L'unique profil, et son établissement.
 *
 * Le schéma vient d'un outil d'établissement : il exige un `etablissement_id`
 * partout. Plutôt que de le déformer, la version locale crée un établissement
 * d'une personne. Le mot « établissement » n'apparaît pas pour autant dans
 * l'interface d'un praticien — c'est le nom de son activité.
 */
async function profil(base) {
  const { rows } = await base.query(
    `SELECT id, nom, prenom, email, role, etablissement_id, actif
       FROM utilisateurs WHERE actif = TRUE ORDER BY created_at LIMIT 1`
  );
  return rows[0] ?? null;
}

/**
 * Journalise, sans bloquer la réponse.
 *
 * Même règle que côté serveur : la trace ne doit jamais retarder ce que
 * l'utilisateur attend, et son échec ne doit rien casser. Sur un appareil
 * personnel elle sert moins à surveiller qu'à reconstituer ce qui s'est passé
 * après un incident.
 */
function journaliser(base, entree) {
  void base
    .query(
      `INSERT INTO audit_logs
         (action, utilisateur_id, utilisateur_libelle, etablissement_id,
          cible_type, cible_id, cible_libelle, details)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [
        entree.action,
        entree.utilisateurId ?? null,
        entree.utilisateurLibelle ?? null,
        entree.etablissementId ?? null,
        entree.cibleType ?? null,
        entree.cibleId ?? null,
        entree.cibleLibelle ?? null,
        entree.details ? JSON.stringify(entree.details) : null,
      ]
    )
    .catch(() => {});
}

// --- Routes ------------------------------------------------------------------

/**
 * Chaque entrée reproduit une route du serveur. L'ordre compte : les chemins
 * les plus spécifiques d'abord, comme dans Express.
 */
const ROUTES = [
  // --- Session -------------------------------------------------------------
  {
    methode: "GET",
    motif: /^\/api\/auth\/etat$/,
    async traiter(base) {
      const utilisateur = await profil(base);
      // `etablissement_existant` sert au serveur à rattacher un premier compte
      // à un établissement déjà peuplé. Sur un appareil personnel il n'y a rien
      // à rattacher : la mise en service crée l'activité en même temps que le
      // profil.
      return reponse(200, {
        initialise: utilisateur !== null,
        utilisateur,
        etablissement_existant: null,
      });
    },
  },
  {
    methode: "POST",
    motif: /^\/api\/auth\/initialisation$/,
    async traiter(base, _params, corps) {
      if (await profil(base)) {
        return erreur(409, "Cette application est déjà en service sur cet appareil.");
      }
      const nom = String(corps?.nom ?? "").trim();
      const prenom = String(corps?.prenom ?? "").trim();
      const email = String(corps?.email ?? "").trim();
      if (!nom || !prenom) {
        return erreur(400, "Requête invalide", {
          fieldErrors: {
            ...(prenom ? {} : { prenom: ["Prénom requis"] }),
            ...(nom ? {} : { nom: ["Nom requis"] }),
          },
        });
      }

      const libelleActivite =
        String(corps?.etablissement ?? "").trim() || `${prenom} ${nom}`;

      return base.transaction(async (tx) => {
        const etab = await tx.query(
          "INSERT INTO etablissements (nom) VALUES ($1) RETURNING id",
          [libelleActivite]
        );
        const etablissementId = etab.rows[0].id;
        // Rôle coordinateur : seul utilisateur de sa base, il doit avoir accès
        // à tout ce que l'interface protège par un rôle.
        const cree = await tx.query(
          `INSERT INTO utilisateurs (nom, prenom, email, role, etablissement_id)
           VALUES ($1,$2,$3,'coordinateur',$4)
           RETURNING id, nom, prenom, email, role, etablissement_id, actif`,
          [nom, prenom, email || `${prenom}.${nom}@local`.toLowerCase(), etablissementId]
        );
        return reponse(201, { utilisateur: cree.rows[0] });
      });
    },
  },
  {
    methode: "POST",
    motif: /^\/api\/auth\/connexion$/,
    traiter: () =>
      erreur(
        400,
        "Il n'y a pas de connexion à faire : les dossiers sont sur cet appareil, " +
          "pas sur un serveur."
      ),
  },
  {
    methode: "POST",
    motif: /^\/api\/auth\/deconnexion$/,
    traiter: () =>
      erreur(
        400,
        "Il n'y a pas de session à fermer. Pour protéger les dossiers, " +
          "verrouillez l'appareil."
      ),
  },
  { methode: "POST", motif: /^\/api\/auth\/mot-de-passe$/, traiter: () => pasEncore("Le changement de mot de passe") },

  // --- Amorçage et trames --------------------------------------------------
  {
    methode: "GET",
    motif: /^\/api\/amorcage$/,
    async traiter(base) {
      const utilisateur = await profil(base);
      if (!utilisateur) {
        return erreur(401, "Application non mise en service sur cet appareil.");
      }
      const [etab, beneficiaires] = await Promise.all([
        base.query(
          "SELECT id, nom, quota_mensuel_bilans FROM etablissements WHERE id = $1",
          [utilisateur.etablissement_id]
        ),
        base.query(
          `SELECT id, nom, prenom, date_naissance FROM patients
            WHERE etablissement_id = $1 ORDER BY nom, prenom`,
          [utilisateur.etablissement_id]
        ),
      ]);
      return reponse(200, {
        utilisateur,
        etablissement: etab.rows[0] ?? null,
        // Pas de quota pour un praticien seul : la jauge disparaît d'elle-même.
        quota: null,
        beneficiaires: beneficiaires.rows,
        equipe: null,
      });
    },
  },
  { methode: "GET", motif: /^\/api\/schema\/bilan$/, traiter: () => reponse(200, SCHEMA_BILAN) },
  { methode: "GET", motif: /^\/api\/schema\/modeles$/, traiter: () => reponse(200, MODELES_BILAN) },

  // --- Activité ------------------------------------------------------------
  {
    methode: "GET",
    motif: /^\/api\/etablissement$/,
    async traiter(base, _p, _c, moi) {
      const { rows } = await base.query(
        "SELECT id, nom, quota_mensuel_bilans FROM etablissements WHERE id = $1",
        [moi.etablissement_id]
      );
      return rows[0] ? reponse(200, rows[0]) : erreur(404, "Activité introuvable");
    },
  },
  {
    methode: "PATCH",
    motif: /^\/api\/etablissement$/,
    async traiter(base, _p, corps, moi) {
      const nom = String(corps?.nom ?? "").trim();
      if (!nom) {
        return erreur(400, "Requête invalide", { fieldErrors: { nom: ["Nom requis"] } });
      }
      const { rows } = await base.query(
        `UPDATE etablissements SET nom = $1 WHERE id = $2
         RETURNING id, nom, quota_mensuel_bilans`,
        [nom, moi.etablissement_id]
      );
      return reponse(200, rows[0]);
    },
  },
  { methode: "GET", motif: /^\/api\/etablissement\/quota$/, traiter: () => reponse(200, null) },
  {
    methode: "GET",
    motif: /^\/api\/etablissement\/audit/,
    async traiter(base, _p, _c, moi) {
      const { rows } = await base.query(
        `SELECT id::text, horodatage, utilisateur_libelle, action,
                cible_type, cible_libelle, adresse_ip
           FROM audit_logs WHERE etablissement_id = $1
          ORDER BY horodatage DESC LIMIT 200`,
        [moi.etablissement_id]
      );
      return reponse(200, rows);
    },
  },
  { methode: "GET", motif: /^\/api\/tableau-de-bord$/, traiter: () => pasEncore("Le suivi des bilans") },
  { methode: "GET", motif: /^\/api\/utilisateurs$/, traiter: () => reponse(200, []) },
  { methode: "POST", motif: /^\/api\/utilisateurs$/, traiter: () => pasEncore("L'ajout de collègues") },

  // --- Brouillon de saisie -------------------------------------------------
  {
    methode: "GET",
    motif: /^\/api\/patients\/([^/]+)\/brouillon$/,
    async traiter(base, [id], _c, moi) {
      const { rows } = await base.query(
        `SELECT texte, periode_debut, periode_fin, source_dictee, maj_le
           FROM brouillons_saisie
          WHERE patient_id = $1 AND utilisateur_id = $2 AND etablissement_id = $3`,
        [id, moi.id, moi.etablissement_id]
      );
      return reponse(200, rows[0] ?? null);
    },
  },
  {
    methode: "PUT",
    motif: /^\/api\/patients\/([^/]+)\/brouillon$/,
    async traiter(base, [id], corps, moi) {
      const texte = String(corps?.texte ?? "");
      // Un brouillon vide n'est pas un brouillon : le garder reviendrait à
      // conserver une donnée de santé sans raison.
      if (texte.trim() === "") {
        await base.query(
          `DELETE FROM brouillons_saisie
            WHERE patient_id = $1 AND utilisateur_id = $2 AND etablissement_id = $3`,
          [id, moi.id, moi.etablissement_id]
        );
        return reponse(204, null);
      }
      const { rows } = await base.query(
        `INSERT INTO brouillons_saisie
           (patient_id, utilisateur_id, etablissement_id,
            texte, periode_debut, periode_fin, source_dictee, maj_le)
         VALUES ($1,$2,$3,$4,$5,$6,$7, now())
         ON CONFLICT (patient_id, utilisateur_id)
         DO UPDATE SET texte = EXCLUDED.texte,
                       periode_debut = EXCLUDED.periode_debut,
                       periode_fin = EXCLUDED.periode_fin,
                       source_dictee = EXCLUDED.source_dictee,
                       maj_le = now()
         RETURNING texte, periode_debut, periode_fin, source_dictee, maj_le`,
        [
          id,
          moi.id,
          moi.etablissement_id,
          texte,
          corps?.periode_debut || null,
          corps?.periode_fin || null,
          corps?.source_dictee ?? false,
        ]
      );
      return reponse(200, rows[0]);
    },
  },
  {
    methode: "DELETE",
    motif: /^\/api\/patients\/([^/]+)\/brouillon$/,
    async traiter(base, [id], _c, moi) {
      await base.query(
        `DELETE FROM brouillons_saisie
          WHERE patient_id = $1 AND utilisateur_id = $2 AND etablissement_id = $3`,
        [id, moi.id, moi.etablissement_id]
      );
      return reponse(204, null);
    },
  },

  // --- Bilans --------------------------------------------------------------
  {
    methode: "GET",
    motif: /^\/api\/patients\/([^/]+)\/bilans\/precedent/,
    async traiter(base, [id], _c, moi, requete) {
      const type = requete.get("type");
      if (type !== "repit" && type !== "trimestriel") {
        return erreur(400, "Type de trame inconnu");
      }
      const { rows } = await base.query(
        `SELECT id, periode_fin FROM bilans
          WHERE patient_id = $1 AND etablissement_id = $2
            AND type_bilan = $3 AND statut = 'validé'
          ORDER BY periode_fin DESC, date_generation DESC LIMIT 1`,
        [id, moi.etablissement_id, type]
      );
      return reponse(200, rows[0] ?? null);
    },
  },
  {
    methode: "POST",
    motif: /^\/api\/patients\/([^/]+)\/bilans\/generate$/,
    async traiter(base, [id], corps, moi) {
      // Contrôles du serveur, réécrits comme le reste de ce fichier.
      const texte = String(corps?.texte ?? "").trim();
      if (!texte) return erreur(400, "Compte-rendu vide");
      if (!corps?.periode_debut || !corps?.periode_fin) {
        return erreur(400, "Requête invalide", { periode: ["Période requise"] });
      }

      const patient = await lirePatient(base, id, moi.etablissement_id);
      if (!patient) return erreur(404, "Bénéficiaire introuvable");

      // Le bilan antérieur donne au moteur la continuité du suivi. Même
      // requête que `getDernierBilanValide` côté serveur.
      const { rows: anciens } = await base.query(
        `SELECT contenu FROM bilans
          WHERE patient_id = $1 AND etablissement_id = $2
            AND type_bilan = 'bilan' AND statut = 'validé'
          ORDER BY periode_fin DESC, date_generation DESC LIMIT 1`,
        [id, moi.etablissement_id]
      );
      const precedent = anciens[0] ? lireContenu(anciens[0].contenu) : null;

      const connus = await contexteDeMasquage(base, patient, moi);

      // Le compte-rendu **et** le contexte antérieur passent par le masquage :
      // les observations d'un bilan validé portent autant de noms que le texte
      // qu'on vient de dicter.
      const { texte: texteMasque, table } = preparerEnvoi(texte, connus);
      const precedentMasque = precedent
        ? masquerPrecedent(precedent, connus)
        : undefined;

      // Avant le tout premier envoi sur cet appareil, l'éducateur voit le
      // texte exact qui va partir. C'est la seule occasion de refuser en
      // connaissance de cause ; ensuite, on ne l'interrompt plus.
      if (!(await validerEnvoi(texteMasque, jetonsPoses(texteMasque, table)))) {
        return erreur(499, "Envoi annulé. Votre compte-rendu est intact.");
      }

      let contenu;
      try {
        contenu = await redigerBilan(texteMasque, precedentMasque);
      } catch (err) {
        if (err instanceof ErreurAssistance) {
          // 503 : la fonction existe mais n'est pas ouverte ici. 502 : elle a
          // échoué. Dans les deux cas le message est écrit pour être lu.
          return erreur(err.motif === "fermee" ? 503 : 502, err.message);
        }
        throw err;
      }

      contenu = restituer(contenu, table);
      // L'en-tête est réécrit depuis la base, jamais gardé du modèle : il n'a
      // reçu aucun nom, il n'a donc rien à en rendre. C'est aussi une surface
      // d'invention en moins.
      contenu.en_tete = enTeteDepuisLaBase(contenu.en_tete, patient, moi, connus, corps);

      const { rows } = await base.query(
        `INSERT INTO bilans
           (patient_id, etablissement_id, auteur_id, type_bilan, periode_debut,
            periode_fin, source, statut, contenu)
         VALUES ($1,$2,$3,'bilan',$4,$5,$6,'brouillon',$7)
         RETURNING id`,
        [
          id,
          moi.etablissement_id,
          moi.id,
          corps.periode_debut,
          corps.periode_fin,
          corps?.source === "audio" ? "audio" : "texte",
          JSON.stringify(contenu),
        ]
      );

      journaliser(base, {
        action: "bilan_genere",
        utilisateurId: moi.id,
        utilisateurLibelle: `${moi.prenom} ${moi.nom} <${moi.email}>`,
        etablissementId: moi.etablissement_id,
        cibleType: "bilan",
        cibleId: rows[0].id,
        cibleLibelle: `${patient.prenom} ${patient.nom}`,
        details: { type_bilan: "bilan", source: corps?.source ?? "texte" },
      });

      return reponse(201, {
        id: rows[0].id,
        statut: "brouillon",
        type_bilan: "bilan",
        contenu,
        quota: null,
      });
    },
  },
  {
    methode: "GET",
    motif: /^\/api\/patients\/([^/]+)\/bilans$/,
    async traiter(base, [id], _c, moi) {
      const { rows } = await base.query(
        `SELECT id, date_generation, type_bilan, periode_debut, periode_fin,
                statut, source
           FROM bilans WHERE patient_id = $1 AND etablissement_id = $2
          ORDER BY periode_fin DESC, date_generation DESC`,
        [id, moi.etablissement_id]
      );
      return reponse(200, rows);
    },
  },
  {
    methode: "POST",
    motif: /^\/api\/patients\/([^/]+)\/bilans$/,
    async traiter(base, [id], corps, moi) {
      const type = corps?.type;
      if (type !== "repit" && type !== "trimestriel") {
        return erreur(400, "Requête invalide", {
          fieldErrors: { type: ["Trame inconnue"] },
        });
      }
      const patient = await lirePatient(base, id, moi.etablissement_id);
      if (!patient) return erreur(404, "Bénéficiaire introuvable");

      let precedent = null;
      if (corps?.reprendre_precedent) {
        const { rows } = await base.query(
          `SELECT id, periode_fin, contenu FROM bilans
            WHERE patient_id = $1 AND etablissement_id = $2
              AND type_bilan = $3 AND statut = 'validé'
            ORDER BY periode_fin DESC, date_generation DESC LIMIT 1`,
          [id, moi.etablissement_id, type]
        );
        precedent = rows[0] ?? null;
      }

      const contenu = precedent
        ? structuredClone(precedent.contenu)
        : contenuVierge(type);

      const { rows } = await base.query(
        `INSERT INTO bilans
           (patient_id, etablissement_id, auteur_id, type_bilan, periode_debut,
            periode_fin, source, statut, contenu, bilan_precedent_id)
         VALUES ($1,$2,$3,$4,$5,$6,'texte','brouillon',$7,$8)
         RETURNING id`,
        [
          id,
          moi.etablissement_id,
          moi.id,
          type,
          corps.periode_debut,
          corps.periode_fin,
          JSON.stringify(contenu),
          precedent?.id ?? null,
        ]
      );

      journaliser(base, {
        action: "bilan_ouvert",
        utilisateurId: moi.id,
        utilisateurLibelle: `${moi.prenom} ${moi.nom} <${moi.email}>`,
        etablissementId: moi.etablissement_id,
        cibleType: "bilan",
        cibleId: rows[0].id,
        cibleLibelle: `${patient.prenom} ${patient.nom}`,
        details: { type_bilan: type, repris_de: precedent?.id ?? null },
      });

      return reponse(201, {
        id: rows[0].id,
        statut: "brouillon",
        type_bilan: type,
        contenu,
        periode_debut: corps.periode_debut,
        periode_fin: corps.periode_fin,
        repris_de: precedent
          ? { id: precedent.id, periode_fin: precedent.periode_fin }
          : null,
        quota: null,
      });
    },
  },
  {
    methode: "GET",
    motif: /^\/api\/bilans\/([^/]+)$/,
    async traiter(base, [id], _c, moi) {
      const bilan = await lireBilan(base, id, moi.etablissement_id);
      if (!bilan) return erreur(404, "Bilan introuvable");

      journaliser(base, {
        action: "bilan_consulte",
        utilisateurId: moi.id,
        utilisateurLibelle: `${moi.prenom} ${moi.nom} <${moi.email}>`,
        etablissementId: moi.etablissement_id,
        cibleType: "bilan",
        cibleId: bilan.id,
        details: { type_bilan: bilan.type_bilan, statut: bilan.statut },
      });
      return reponse(200, bilan);
    },
  },
  {
    methode: "PATCH",
    motif: /^\/api\/bilans\/([^/]+)$/,
    async traiter(base, [id], corps, moi) {
      const existant = await lireBilan(base, id, moi.etablissement_id);
      if (!existant) return erreur(404, "Bilan introuvable");
      if (existant.statut === "validé") {
        return erreur(
          409,
          "Bilan déjà validé : archivage définitif, non modifiable"
        );
      }
      if (corps?.contenu === undefined && corps?.statut === undefined) {
        return erreur(400, "Requête invalide", {
          fieldErrors: { contenu: ["Fournir `contenu` et/ou `statut`"] },
        });
      }

      const { rows } = await base.query(
        `UPDATE bilans
            SET contenu = COALESCE($1, contenu),
                statut  = COALESCE($2, statut)
          WHERE id = $3 AND etablissement_id = $4
          RETURNING id, patient_id, etablissement_id, auteur_id, date_generation,
                    type_bilan, periode_debut, periode_fin, statut, source,
                    bilan_precedent_id, contenu`,
        [
          corps.contenu === undefined ? null : JSON.stringify(corps.contenu),
          corps.statut ?? null,
          id,
          moi.etablissement_id,
        ]
      );

      journaliser(base, {
        action: corps.statut === "validé" ? "bilan_valide" : "bilan_modifie",
        utilisateurId: moi.id,
        utilisateurLibelle: `${moi.prenom} ${moi.nom} <${moi.email}>`,
        etablissementId: moi.etablissement_id,
        cibleType: "bilan",
        cibleId: id,
        details: { type_bilan: existant.type_bilan },
      });

      return reponse(200, rows[0]);
    },
  },

  // --- Bénéficiaires -------------------------------------------------------
  {
    methode: "GET",
    motif: /^\/api\/patients$/,
    async traiter(base, _p, _c, moi) {
      const { rows } = await base.query(
        `SELECT id, nom, prenom, date_naissance FROM patients
          WHERE etablissement_id = $1 ORDER BY nom, prenom`,
        [moi.etablissement_id]
      );
      return reponse(200, rows);
    },
  },
  {
    methode: "POST",
    motif: /^\/api\/patients$/,
    async traiter(base, _p, corps, moi) {
      const nom = String(corps?.nom ?? "").trim();
      const prenom = String(corps?.prenom ?? "").trim();
      if (!nom || !prenom) {
        return erreur(400, "Requête invalide", {
          fieldErrors: {
            ...(prenom ? {} : { prenom: ["Prénom requis"] }),
            ...(nom ? {} : { nom: ["Nom requis"] }),
          },
        });
      }
      const { rows } = await base.query(
        `INSERT INTO patients (nom, prenom, date_naissance, etablissement_id)
         VALUES ($1,$2,$3,$4) RETURNING id`,
        [nom, prenom, corps?.date_naissance || null, moi.etablissement_id]
      );
      journaliser(base, {
        action: "beneficiaire_cree",
        utilisateurId: moi.id,
        utilisateurLibelle: `${moi.prenom} ${moi.nom} <${moi.email}>`,
        etablissementId: moi.etablissement_id,
        cibleType: "beneficiaire",
        cibleId: rows[0].id,
        cibleLibelle: `${prenom} ${nom}`,
      });
      return reponse(201, rows[0]);
    },
  },
  {
    methode: "PATCH",
    motif: /^\/api\/patients\/([^/]+)$/,
    async traiter(base, [id], corps, moi) {
      const nom = String(corps?.nom ?? "").trim();
      const prenom = String(corps?.prenom ?? "").trim();
      if (!nom || !prenom) {
        return erreur(400, "Requête invalide", {
          fieldErrors: {
            ...(prenom ? {} : { prenom: ["Prénom requis"] }),
            ...(nom ? {} : { nom: ["Nom requis"] }),
          },
        });
      }
      const { rows } = await base.query(
        `UPDATE patients SET nom = $1, prenom = $2, date_naissance = $3
          WHERE id = $4 AND etablissement_id = $5
          RETURNING id, nom, prenom, date_naissance, etablissement_id`,
        [nom, prenom, corps?.date_naissance || null, id, moi.etablissement_id]
      );
      if (!rows[0]) return erreur(404, "Bénéficiaire introuvable");
      return reponse(200, rows[0]);
    },
  },
  {
    methode: "DELETE",
    motif: /^\/api\/patients\/([^/]+)$/,
    async traiter(base, [id], _c, moi) {
      const patient = await lirePatient(base, id, moi.etablissement_id);
      if (!patient) return erreur(404, "Bénéficiaire introuvable");

      // Les bilans partent par la cascade posée en migration 011. On les compte
      // avant : la trace doit attester de l'étendue réelle de l'effacement.
      const bilans = await base.transaction(async (tx) => {
        const { rows } = await tx.query(
          "SELECT count(*)::int AS n FROM bilans WHERE patient_id = $1",
          [id]
        );
        await tx.query(
          "DELETE FROM patients WHERE id = $1 AND etablissement_id = $2",
          [id, moi.etablissement_id]
        );
        return rows[0].n;
      });

      journaliser(base, {
        action: "beneficiaire_supprime",
        utilisateurId: moi.id,
        utilisateurLibelle: `${moi.prenom} ${moi.nom} <${moi.email}>`,
        etablissementId: moi.etablissement_id,
        cibleType: "beneficiaire",
        cibleId: id,
        cibleLibelle: `${patient.prenom} ${patient.nom}`,
        details: { bilans_supprimes: bilans },
      });
      return reponse(204, null);
    },
  },
  {
    methode: "GET",
    motif: /^\/api\/patients\/([^/]+)$/,
    async traiter(base, [id], _c, moi) {
      const patient = await lirePatient(base, id, moi.etablissement_id);
      return patient ? reponse(200, patient) : erreur(404, "Bénéficiaire introuvable");
    },
  },

  // --- Ce qui demande le serveur ------------------------------------------
  {
    methode: "POST",
    motif: /^\/api\/assistance\/reformulation$/,
    async traiter(base, _captures, corps, moi) {
      const texte = String(corps?.texte ?? "");
      if (!texte.trim()) return erreur(400, "Rien à reformuler");

      // Un commentaire de parcours guidé porte les mêmes noms qu'un
      // compte-rendu : même masquage, même chemin.
      const connus = await contexteDeMasquage(base, null, moi);
      const { texte: masque, table } = preparerEnvoi(texte, connus);

      try {
        return reponse(200, {
          texte: restituer(await reformuler(masque, corps?.intitule), table),
        });
      } catch (err) {
        if (err instanceof ErreurAssistance) {
          return erreur(err.motif === "fermee" ? 503 : 502, err.message);
        }
        throw err;
      }
    },
  },
  {
    methode: "GET",
    motif: /^\/api\/etablissement\/sauvegarde/,
    traiter: () => pasEncore("La sauvegarde"),
  },
];

// --- Fragments partagés ------------------------------------------------------

/** Le contenu d'un bilan, que PGlite rende un objet ou une chaîne JSON. */
function lireContenu(brut) {
  if (typeof brut === "string") {
    try {
      return JSON.parse(brut);
    } catch {
      return null;
    }
  }
  return brut ?? null;
}

/**
 * Ce que la base sait des noms, pour le masquage.
 *
 * Tous les bénéficiaires du dossier, pas seulement celui du bilan : un
 * compte-rendu de séance collective en nomme plusieurs, et celui qu'on ne
 * masquerait pas serait justement celui dont on ne parle pas.
 */
async function contexteDeMasquage(base, patient, moi) {
  const { rows: tous } = await base.query(
    "SELECT id, nom, prenom FROM patients WHERE etablissement_id = $1",
    [moi.etablissement_id]
  );
  const { rows: etab } = await base.query(
    "SELECT nom FROM etablissements WHERE id = $1",
    [moi.etablissement_id]
  );

  return {
    beneficiaire: patient ?? null,
    autres: tous.filter((p) => !patient || p.id !== patient.id),
    auteur: { prenom: moi.prenom, nom: moi.nom },
    activite: etab[0]?.nom ?? "",
  };
}

/** Masque les deux sections du bilan antérieur transmises au moteur. */
function masquerPrecedent(precedent, connus) {
  const sections = {
    evaluation_objectifs_par_domaine:
      precedent.evaluation_objectifs_par_domaine ?? [],
    proposition_objectifs_periode_suivante:
      precedent.proposition_objectifs_periode_suivante ?? [],
  };
  // `preparerEnvoi` masque une chaîne ; on passe par le JSON pour couvrir
  // toute la structure d'un coup, jetons compris.
  return JSON.parse(preparerEnvoi(JSON.stringify(sections), connus).texte);
}

/** Âge en années révolues, ou `0` si la date de naissance manque. */
function ageDe(dateNaissance) {
  if (!dateNaissance) return 0;
  const naissance = new Date(dateNaissance);
  if (Number.isNaN(naissance.getTime())) return 0;
  const aujourdhui = new Date();
  let annees = aujourdhui.getFullYear() - naissance.getFullYear();
  const mois = aujourdhui.getMonth() - naissance.getMonth();
  if (mois < 0 || (mois === 0 && aujourdhui.getDate() < naissance.getDate())) {
    annees -= 1;
  }
  return annees >= 0 && annees < 130 ? annees : 0;
}

/**
 * L'en-tête, repris de la base plutôt que du modèle.
 *
 * Le moteur n'a jamais reçu de nom : il n'a donc rien à en rendre, et ce qu'il
 * aurait pu écrire ici serait inventé. Les champs que la base ne connaît pas —
 * lieux, personnes présentes, horaires — restent ceux qu'il a déduits du
 * compte-rendu, ou vides. Un champ vide reste visiblement vide.
 */
function enTeteDepuisLaBase(enTeteDuModele, patient, moi, connus, corps) {
  const auteur = `${moi.prenom} ${moi.nom}`.trim();
  return {
    ...enTeteDuModele,
    structure: connus.activite || enTeteDuModele?.structure || "",
    periode_debut: corps.periode_debut,
    periode_fin: corps.periode_fin,
    beneficiaire_nom: `${patient.prenom} ${patient.nom}`.trim(),
    beneficiaire_age: ageDe(patient.date_naissance),
    beneficiaire_date_naissance: patient.date_naissance
      ? String(patient.date_naissance).slice(0, 10)
      : null,
    professionnels_intervenants: [auteur],
  };
}

async function lirePatient(base, id, etablissementId) {
  const { rows } = await base.query(
    `SELECT id, nom, prenom, date_naissance, etablissement_id
       FROM patients WHERE id = $1 AND etablissement_id = $2`,
    [id, etablissementId]
  );
  return rows[0] ?? null;
}

async function lireBilan(base, id, etablissementId) {
  const { rows } = await base.query(
    `SELECT id, patient_id, etablissement_id, auteur_id, date_generation,
            type_bilan, periode_debut, periode_fin, statut, source,
            bilan_precedent_id, contenu
       FROM bilans WHERE id = $1 AND etablissement_id = $2`,
    [id, etablissementId]
  );
  return rows[0] ?? null;
}

// --- Point d'entrée ----------------------------------------------------------

/**
 * Traite une requête comme le ferait le serveur.
 *
 * @param {string} methode  GET, POST, PUT, PATCH, DELETE
 * @param {string} url      chemin, éventuellement avec sa chaîne de requête
 * @param {unknown} corps   déjà désérialisé
 * @returns {Promise<{statut: number, donnees: unknown}>}
 */
export async function traiter(methode, url, corps) {
  const [chemin, requete] = url.split("?");
  const parametres = new URLSearchParams(requete ?? "");

  const route = ROUTES.find(
    (r) => r.methode === methode && r.motif.test(chemin)
  );
  if (!route) {
    return erreur(404, `Route inconnue : ${methode} ${chemin}`);
  }

  const base = await ouvrirBase();
  const captures = chemin.match(route.motif).slice(1);

  // Les routes de session s'exécutent sans profil ; toutes les autres en ont
  // besoin, et le réclamer une fois ici évite de l'oublier vingt fois.
  const publique = /^\/api\/auth\//.test(chemin);
  let moi = null;
  if (!publique) {
    moi = await profil(base);
    if (!moi) {
      return erreur(401, "Application non mise en service sur cet appareil.");
    }
  }

  return route.traiter(base, captures, corps, moi, parametres);
}
