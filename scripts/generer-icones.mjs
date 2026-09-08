/**
 * Dessine les icônes de l'application installée.
 *
 * Android réclame de vraies images matricielles pour poser une icône sur
 * l'écran d'accueil : le SVG de l'onglet ne suffit pas. Plutôt que d'ajouter
 * une bibliothèque de rendu — ou pire, de charger une icône depuis un service
 * externe, ce que le projet s'interdit — on écrit les pixels et le PNG à la
 * main. Le format n'a rien de sorcier : un en-tête, des pixels compressés par
 * zlib, une somme de contrôle par bloc.
 *
 * L'icône reprend le dessin de l'onglet : carré arrondi terracotta, feuille
 * blanche, deux lignes de texte.
 *
 *   npm run generer:icones
 */
import { deflateSync } from "node:zlib";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const DESTINATION = path.join("public", "icones");

const TERRACOTTA = [194, 107, 60];
const CREME = [255, 253, 250];

// --- Dessin ------------------------------------------------------------------

function creerToile(taille) {
  return { taille, pixels: new Uint8Array(taille * taille * 4) };
}

function poser(toile, x, y, couleur, alpha = 255) {
  if (x < 0 || y < 0 || x >= toile.taille || y >= toile.taille) return;
  const i = (y * toile.taille + x) * 4;
  const a = alpha / 255;
  // Composition sur ce qui est déjà là : les bords adoucis en dépendent.
  for (let c = 0; c < 3; c++) {
    toile.pixels[i + c] = Math.round(toile.pixels[i + c] * (1 - a) + couleur[c] * a);
  }
  toile.pixels[i + 3] = Math.max(toile.pixels[i + 3], alpha);
}

/**
 * Rectangle à coins arrondis, avec un bord adouci.
 *
 * L'adoucissement est calculé sur la distance au coin plutôt qu'obtenu par
 * suréchantillonnage : à ces tailles, un bord dur se voit sur l'écran d'accueil
 * d'un téléphone à forte densité.
 */
function rectangleArrondi(toile, x0, y0, largeur, hauteur, rayon, couleur) {
  for (let y = Math.floor(y0); y < y0 + hauteur; y++) {
    for (let x = Math.floor(x0); x < x0 + largeur; x++) {
      const dx = Math.max(x0 + rayon - x, x - (x0 + largeur - 1 - rayon), 0);
      const dy = Math.max(y0 + rayon - y, y - (y0 + hauteur - 1 - rayon), 0);
      const distance = Math.hypot(dx, dy);
      if (distance <= rayon - 1) {
        poser(toile, x, y, couleur);
      } else if (distance < rayon) {
        poser(toile, x, y, couleur, Math.round(255 * (rayon - distance)));
      }
    }
  }
}

/**
 * @param {number} taille    côté de l'image, en pixels
 * @param {number} marge     part du côté laissée vide autour du dessin. Une
 *                           icône « maskable » est rognée par Android selon la
 *                           forme du lanceur : sans marge, la feuille est
 *                           amputée.
 */
function dessinerIcone(taille, marge = 0) {
  const toile = creerToile(taille);
  const bord = Math.round(taille * marge);
  const cote = taille - bord * 2;

  // Fond : carré arrondi, ou disque plein pour une icône rognable.
  rectangleArrondi(
    toile,
    bord,
    bord,
    cote,
    cote,
    marge > 0 ? cote / 2 : cote * 0.22,
    TERRACOTTA
  );

  // Feuille de papier, avec le coin supérieur droit replié.
  const l = cote * 0.44;
  const h = cote * 0.56;
  const x = bord + (cote - l) / 2;
  const y = bord + (cote - h) / 2;
  rectangleArrondi(toile, x, y, l, h, cote * 0.04, CREME);
  const pli = cote * 0.13;
  for (let dy = 0; dy < pli; dy++) {
    for (let dx = 0; dx < pli - dy; dx++) {
      poser(toile, Math.round(x + l - 1 - dx), Math.round(y + dy), TERRACOTTA);
    }
  }

  // Deux lignes de texte.
  const epaisseur = Math.max(2, Math.round(cote * 0.045));
  rectangleArrondi(toile, x + l * 0.18, y + h * 0.5, l * 0.64, epaisseur, epaisseur / 2, TERRACOTTA);
  rectangleArrondi(toile, x + l * 0.18, y + h * 0.68, l * 0.44, epaisseur, epaisseur / 2, TERRACOTTA);

  return toile;
}

// --- Encodage PNG ------------------------------------------------------------

function crc32(donnees) {
  let c = ~0;
  for (const octet of donnees) {
    c ^= octet;
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}

function bloc(type, contenu) {
  const nom = Buffer.from(type, "ascii");
  const corps = Buffer.concat([nom, contenu]);
  const entete = Buffer.alloc(4);
  entete.writeUInt32BE(contenu.length);
  const somme = Buffer.alloc(4);
  somme.writeUInt32BE(crc32(corps));
  return Buffer.concat([entete, corps, somme]);
}

function encoderPng(toile) {
  const { taille, pixels } = toile;

  // Chaque ligne est précédée de son octet de filtre ; 0 = aucun filtre.
  const brut = Buffer.alloc(taille * (taille * 4 + 1));
  for (let y = 0; y < taille; y++) {
    const debut = y * (taille * 4 + 1);
    brut[debut] = 0;
    Buffer.from(pixels.buffer, y * taille * 4, taille * 4).copy(brut, debut + 1);
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(taille, 0);
  ihdr.writeUInt32BE(taille, 4);
  ihdr[8] = 8; // 8 bits par canal
  ihdr[9] = 6; // RVB + alpha
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    bloc("IHDR", ihdr),
    bloc("IDAT", deflateSync(brut, { level: 9 })),
    bloc("IEND", Buffer.alloc(0)),
  ]);
}

// --- Production --------------------------------------------------------------

const ICONES = [
  { nom: "icone-192.png", taille: 192, marge: 0 },
  { nom: "icone-512.png", taille: 512, marge: 0 },
  // Rognable : Android y découpe la forme de son lanceur. Le dessin est réduit
  // pour rester entier quelle que soit la découpe.
  { nom: "icone-maskable-512.png", taille: 512, marge: 0.1 },
];

async function main() {
  await mkdir(DESTINATION, { recursive: true });
  for (const { nom, taille, marge } of ICONES) {
    const png = encoderPng(dessinerIcone(taille, marge));
    await writeFile(path.join(DESTINATION, nom), png);
    console.log(`  ${nom.padEnd(26)} ${taille}×${taille}, ${(png.length / 1024).toFixed(1)} Kio`);
  }
  console.log(`\nIcônes écrites dans ${DESTINATION}.`);
}

main().catch((err) => {
  console.error("Échec du dessin des icônes :", err.message);
  process.exit(1);
});
