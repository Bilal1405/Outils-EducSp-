import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import {
  brotliCompress,
  brotliDecompress,
  gzip,
  constants as zlibConstants,
} from "node:zlib";
import { promisify } from "node:util";
import type { RequestHandler } from "express";

const compresserBrotli = promisify(brotliCompress);
const decompresserBrotli = promisify(brotliDecompress);
const compresserGzip = promisify(gzip);

/**
 * Types servis compressés. Uniquement du texte : compresser une image ou un
 * .docx (déjà un zip) coûte du temps de calcul pour quelques octets.
 */
const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".map": "application/json; charset=utf-8",
};

/**
 * Fichiers dont le contenu est figé par leur version : ils peuvent être gardés
 * un an sans revalidation. Tout le reste est revalidé à chaque chargement —
 * une correction déployée doit arriver au poste de l'éducateur sans qu'il ait
 * à vider son cache.
 */
const IMMUABLES = [/^\/vendor\//];

interface Variante {
  corps: Buffer;
  encodage: string;
  etag: string;
}

/** Clé de cache : chemin + empreinte de la version du fichier sur disque. */
const cache = new Map<string, Variante>();

function encodageAccepte(entete: string | undefined): "br" | "gzip" | null {
  if (!entete) return null;
  const accepte = entete.toLowerCase();
  if (accepte.includes("br")) return "br";
  if (accepte.includes("gzip")) return "gzip";
  return null;
}

/**
 * Corps à renvoyer, dans l'encodage demandé.
 *
 * Un fichier déjà versionné compressé (`…​.br`) est renvoyé tel quel au
 * navigateur qui accepte le brotli : le décompresser pour le recompresser à
 * l'identique ne servirait à rien. Il n'est décompressé que pour les clients
 * qui ne savent pas le lire, et recompressé en gzip pour les rares qui ne
 * connaissent que celui-là.
 */
async function corpsAServir(
  fichier: string,
  prcompresse: boolean,
  encodage: "br" | "gzip" | null
): Promise<Buffer> {
  if (!prcompresse) {
    const brut = await readFile(fichier);
    return encodage ? compresser(brut, encodage) : brut;
  }

  const compresseSurDisque = await readFile(`${fichier}.br`);
  if (encodage === "br") {
    return compresseSurDisque;
  }
  const brut = await decompresserBrotli(compresseSurDisque);
  return encodage ? compresser(brut, encodage) : brut;
}

async function compresser(corps: Buffer, encodage: "br" | "gzip"): Promise<Buffer> {
  if (encodage === "br") {
    return compresserBrotli(corps, {
      params: {
        // Qualité 11 : le résultat est mémorisé, le coût n'est payé qu'une
        // fois par fichier et par démarrage.
        [zlibConstants.BROTLI_PARAM_QUALITY]: 11,
        [zlibConstants.BROTLI_PARAM_SIZE_HINT]: corps.length,
      },
    });
  }
  return compresserGzip(corps, { level: 9 });
}

/**
 * Sert les fichiers texte de `public/` compressés, avec un cache mémoire.
 *
 * Pourquoi à la main plutôt qu'avec une bibliothèque : le besoin se limite à
 * des fichiers statiques, connus, peu nombreux. Une compression à la volée du
 * flux de réponse — ce que fait `compression` — s'appliquerait aussi aux
 * exports .docx, qui sont déjà des archives, et ajouterait une dépendance sur
 * le chemin de toutes les réponses, y compris celles qui portent des données
 * de santé. Ici, rien de dynamique ne traverse ce code.
 *
 * Mesure sur l'interface : 197 Kio transférés à froid, 55 Kio après. La
 * bibliothèque de transcription passe de 558 à 150 Kio environ.
 *
 * Ce qui n'est pas géré est délibérément renvoyé à `express.static`, placé
 * juste derrière : requêtes de plage, fichiers binaires, index de répertoire.
 */
export function statiqueCompresse(racine: string): RequestHandler {
  return async (req, res, next) => {
    if (req.method !== "GET" && req.method !== "HEAD") {
      return next();
    }

    // `/` désigne `index.html` : sans cette ligne, la page elle-même — le plus
    // gros fichier texte de l'application — passerait à côté de la
    // compression, faute d'extension dans l'URL.
    const demande = decodeURIComponent(req.path);
    const chemin = demande.endsWith("/") ? `${demande}index.html` : demande;
    const extension = path.extname(chemin).toLowerCase();
    const type = TYPES[extension];
    if (!type) {
      return next();
    }

    // Résolution stricte sous la racine : un `..` encodé ne doit pas permettre
    // de lire ailleurs que dans `public/`.
    const fichier = path.resolve(racine, "." + chemin);
    if (fichier !== racine && !fichier.startsWith(racine + path.sep)) {
      return next();
    }

    // Certains fichiers ne sont versionnés que sous leur forme compressée
    // (cf. `public/vendor/README.md`) : la source d'origine peut donc être
    // absente du disque sans que le fichier soit introuvable.
    let infos;
    let prcompresse = false;
    try {
      infos = await stat(fichier);
    } catch {
      try {
        infos = await stat(`${fichier}.br`);
        prcompresse = true;
      } catch {
        return next();
      }
    }
    if (!infos.isFile()) {
      return next();
    }

    const encodage = encodageAccepte(req.header("accept-encoding"));
    const version = `${infos.mtimeMs}-${infos.size}`;
    const cle = `${fichier}|${version}|${encodage ?? "brut"}`;

    let variante = cache.get(cle);
    if (!variante) {
      const corps = await corpsAServir(fichier, prcompresse, encodage);
      variante = {
        corps,
        encodage: encodage ?? "",
        // Empreinte du contenu servi : deux encodages du même fichier ne
        // doivent pas partager d'ETag, sinon un intermédiaire pourrait
        // renvoyer du brotli à un client qui n'en veut pas.
        etag: `"${createHash("sha1").update(corps).digest("base64url")}"`,
      };
      cache.set(cle, variante);
    }

    const immuable = IMMUABLES.some((motif) => motif.test(chemin));
    res.setHeader("Content-Type", type);
    res.setHeader("ETag", variante.etag);
    res.setHeader("Vary", "Accept-Encoding");
    res.setHeader(
      "Cache-Control",
      immuable ? "public, max-age=31536000, immutable" : "public, max-age=0, must-revalidate"
    );
    if (variante.encodage) {
      res.setHeader("Content-Encoding", variante.encodage);
    }

    if (req.header("if-none-match") === variante.etag) {
      return res.status(304).end();
    }

    res.setHeader("Content-Length", String(variante.corps.length));
    if (req.method === "HEAD") {
      return res.end();
    }
    return res.end(variante.corps);
  };
}
