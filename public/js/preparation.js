/**
 * Écran de préparation : tout ce que l'outil doit télécharger, il le télécharge
 * ici, avant que l'éducateur ne commence à écrire.
 *
 * La dictée reposait jusqu'ici sur un chargement à la demande : la
 * bibliothèque, le moteur d'inférence WebAssembly et les poids du modèle
 * n'étaient récupérés qu'au premier clic sur le micro. L'attente tombait donc
 * au pire moment — après avoir parlé, en regardant un texte qui ne vient pas —
 * et se répétait à chaque nouvel onglet pour l'instanciation du graphe, même
 * quand les poids étaient déjà en cache.
 *
 * Le coût n'a pas disparu : il est déplacé là où il ne coûte rien, juste après
 * la connexion, à un moment où personne n'attend une phrase précise. Ce qui
 * change vraiment, c'est qu'il est visible, chiffré, et qu'on peut passer
 * outre.
 *
 * Deux principes tiennent le reste :
 *
 *  - **jamais de blocage définitif.** Un poste sans accès à huggingface.co doit
 *    rester capable d'écrire à la main. L'échec propose donc de continuer, il
 *    n'enferme pas ;
 *  - **jamais de téléchargement muet.** Cent cinquante mégaoctets sur la
 *    connexion d'un établissement, cela s'annonce.
 */
import { $ } from "./ui.js";

/**
 * Sous ce délai, l'écran n'apparaît pas du tout.
 *
 * Quand le modèle est déjà en cache, la préparation dure moins d'une seconde :
 * afficher puis retirer un écran aussitôt produirait un clignotement, plus
 * gênant que l'attente qu'il prétend expliquer.
 */
const SEUIL_AFFICHAGE_MS = 400;

let ecranAffiche = false;

function mo(octets) {
  return `${(octets / 1024 / 1024).toFixed(0)} Mo`;
}

function afficher(premiereFois) {
  if (ecranAffiche) return;
  ecranAffiche = true;

  $("preparation-premiere").hidden = !premiereFois;
  $("preparation").hidden = false;
  // L'application est peinte dessous : sans `inert`, elle resterait navigable
  // au clavier sous l'écran, et un lecteur d'écran la lirait par-dessus.
  $("app").inert = true;
  $("entete").inert = true;
  $("preparation-passer").focus();
}

function masquer() {
  if (!ecranAffiche) return;
  ecranAffiche = false;
  $("preparation").hidden = true;
  $("app").inert = false;
  $("entete").inert = false;
}

/**
 * Totalise l'avancement de plusieurs fichiers.
 *
 * transformers.js rend compte fichier par fichier — cinq à sept selon le
 * modèle. Un pourcentage par fichier ne dit rien de l'attente restante : il
 * atteint 100 % six fois de suite. On additionne donc, en n'affichant que ce
 * qu'on sait réellement.
 */
function compteurDeTelechargement() {
  const fichiers = new Map();

  return (progression) => {
    if (!progression || !progression.file) return null;

    if (progression.status === "progress" && progression.total) {
      fichiers.set(progression.file, {
        charge: progression.loaded,
        total: progression.total,
      });
    } else if (progression.status === "done" && fichiers.has(progression.file)) {
      const entree = fichiers.get(progression.file);
      entree.charge = entree.total;
    }

    let charge = 0;
    let total = 0;
    for (const entree of fichiers.values()) {
      charge += entree.charge;
      total += entree.total;
    }
    return total > 0 ? { charge, total } : null;
  };
}

function majBarre(cumul) {
  const barre = $("preparation-barre");
  const chiffres = $("preparation-taille");

  if (!cumul) {
    chiffres.textContent = "";
    return;
  }

  const pct = Math.min(100, Math.round((cumul.charge / cumul.total) * 100));
  barre.style.width = `${pct}%`;
  barre.parentElement.setAttribute("aria-valuenow", String(pct));
  chiffres.textContent = `${mo(cumul.charge)} sur ${mo(cumul.total)}`;
}

function signalerEchec(raison) {
  afficher(false);
  $("preparation-encours").hidden = true;
  $("preparation-echec").hidden = false;
  // Les explications de `transcription.js` sont écrites pour suivre « La dictée
  // a échoué : » et commencent donc en minuscule. Ici elles tiennent seules.
  $("preparation-echec-texte").textContent = raison
    ? raison.charAt(0).toUpperCase() + raison.slice(1)
    : "La préparation de la dictée n'a pas abouti sur ce poste.";
  $("preparation-continuer").focus();
}

/**
 * Prépare tout ce qui devrait sinon se charger en cours de saisie.
 *
 * Ne rejette jamais : une préparation ratée est une gêne, pas une panne, et
 * l'outil doit rester utilisable au clavier dans tous les cas.
 */
export async function preparerOutil() {
  let module;
  try {
    module = await import("/transcription.js");
  } catch {
    // La bibliothèque est absente du serveur : la dictée ne marchera pas, mais
    // ce n'est pas à cet écran de l'annoncer — le micro le dira, et
    // `/diagnostic.html` le nommera précisément.
    return;
  }

  if (module.modelePret()) return;

  const premiereFois = !module.modeleDejaCharge();
  const totaliser = compteurDeTelechargement();
  let abandonne = false;

  const minuterie = setTimeout(() => afficher(premiereFois), SEUIL_AFFICHAGE_MS);

  $("preparation-passer").onclick = () => {
    // Le chargement continue en arrière-plan : l'éducateur n'attend plus
    // devant l'écran, mais il ne repart pas de zéro non plus.
    abandonne = true;
    masquer();
  };
  $("preparation-continuer").onclick = () => {
    abandonne = true;
    masquer();
  };

  const pret = await module.prechargerModele((_etape, _pct, brut) => {
    if (abandonne) return;
    const cumul = totaliser(brut);
    majBarre(cumul);
    // Le libellé suit ce qui se passe réellement. Une fois les octets reçus, il
    // reste l'instanciation du graphe ONNX — quelques secondes pendant
    // lesquelles rien ne progresse, et où « téléchargement » serait faux.
    $("preparation-etape").textContent =
      cumul && cumul.charge < cumul.total
        ? "Téléchargement du modèle de transcription…"
        : "Mise en place du moteur de transcription…";
  });

  clearTimeout(minuterie);

  if (abandonne) return;
  if (pret) {
    masquer();
    return;
  }
  signalerEchec(module.raisonEchecPreparation());
}
