import { randomBytes, scrypt, timingSafeEqual, type ScryptOptions } from "node:crypto";

/**
 * `promisify` ne conserve pas la surcharge de `scrypt` qui accepte des
 * options : on enveloppe explicitement pour garder N, r et p typés.
 */
function scryptAsync(
  motDePasse: string,
  sel: Buffer,
  longueur: number,
  options: ScryptOptions
): Promise<Buffer> {
  return new Promise((resoudre, rejeter) => {
    scrypt(motDePasse, sel, longueur, options, (err, cle) =>
      err ? rejeter(err) : resoudre(cle)
    );
  });
}

/**
 * Hachage des mots de passe.
 *
 * `scrypt` est retenu parce qu'il est dans la bibliothèque standard de Node :
 * pas de dépendance native à recompiler, rien à maintenir, et une fonction
 * volontairement coûteuse en mémoire — ce qui la rend chère à attaquer avec du
 * matériel spécialisé, contrairement à un simple SHA.
 *
 * Les paramètres sont stockés avec l'empreinte : les durcir plus tard
 * n'invalidera pas les mots de passe existants, chaque hachage porte les siens.
 */

const N = 16384; // coût CPU/mémoire (2^14)
const R = 8;
const P = 1;
const LONGUEUR_CLE = 64;
const LONGUEUR_SEL = 16;

export async function hacherMotDePasse(motDePasse: string): Promise<string> {
  const sel = randomBytes(LONGUEUR_SEL);
  const cle = await scryptAsync(motDePasse.normalize("NFKC"), sel, LONGUEUR_CLE, {
    N,
    r: R,
    p: P,
  });
  return ["scrypt", N, R, P, sel.toString("base64"), cle.toString("base64")].join("$");
}

/**
 * Vérifie un mot de passe contre son empreinte.
 *
 * La comparaison est à temps constant : comparer avec `===` laisserait fuiter,
 * par la durée de la réponse, le nombre d'octets corrects en tête.
 */
export async function verifierMotDePasse(
  motDePasse: string,
  empreinte: string | null
): Promise<boolean> {
  if (!empreinte) {
    return false;
  }

  const parties = empreinte.split("$");
  if (parties.length !== 6 || parties[0] !== "scrypt") {
    return false;
  }

  const [, n, r, p, selBase64, cleBase64] = parties;
  const sel = Buffer.from(selBase64, "base64");
  const attendue = Buffer.from(cleBase64, "base64");

  let calculee: Buffer;
  try {
    calculee = await scryptAsync(motDePasse.normalize("NFKC"), sel, attendue.length, {
      N: Number(n),
      r: Number(r),
      p: Number(p),
    });
  } catch {
    return false;
  }

  return calculee.length === attendue.length && timingSafeEqual(calculee, attendue);
}

/**
 * Exigences minimales. Volontairement fondées sur la longueur plutôt que sur
 * une composition imposée : « au moins une majuscule et un chiffre » produit
 * surtout des mots de passe courts et prévisibles, et c'est la recommandation
 * actuelle de l'ANSSI comme du NIST de privilégier la longueur.
 */
export const LONGUEUR_MOT_DE_PASSE_MIN = 12;

export function motDePasseAcceptable(motDePasse: string): string | null {
  if (motDePasse.length < LONGUEUR_MOT_DE_PASSE_MIN) {
    return `Le mot de passe doit faire au moins ${LONGUEUR_MOT_DE_PASSE_MIN} caractères.`;
  }
  if (motDePasse.trim() === "") {
    return "Le mot de passe ne peut pas être uniquement des espaces.";
  }
  return null;
}
