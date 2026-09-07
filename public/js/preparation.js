/**
 * Préparation de la dictée : tout ce que l'outil doit télécharger, il le
 * télécharge ici, avant que l'éducateur ne commence à écrire.
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
 *    rester capable d'écrire à la main. L'étape est donc déclarée non
 *    bloquante : l'écran offre toujours une sortie tant qu'elle est la seule à
 *    tourner ;
 *  - **jamais de téléchargement muet.** Cent cinquante mégaoctets sur la
 *    connexion d'un établissement, cela s'annonce.
 *
 * Ce fichier ne touche plus au DOM : il rend compte à `chargement.js`, qui
 * décide seul de ce qui s'affiche et quand.
 */
import { suivre } from "./chargement.js";

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

/**
 * Prépare tout ce qui devrait sinon se charger en cours de saisie.
 *
 * Ne rejette jamais : une préparation ratée est une gêne, pas une panne, et
 * l'outil doit rester utilisable au clavier dans tous les cas.
 */
export async function preparerOutil({ seulementSiDejaCharge = false } = {}) {
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

  const etape = suivre("dictee", "Moteur de dictée", { bloquante: false });

  // La question est posée au cache du navigateur, pas à un drapeau : c'est lui
  // qui décide si la préparation coûtera du réseau, et lui seul le sait.
  const enCache = await module.modeleEnCache();
  const premiereFois = !enCache.present;

  // Sur un téléphone, engager cent quarante mégaoctets sans qu'on les ait
  // demandés serait présumer d'une connexion illimitée. Quand le modèle est
  // déjà là, en revanche, le remettre en mémoire ne coûte aucun réseau et fait
  // gagner les quelques secondes d'instanciation du graphe.
  if (seulementSiDejaCharge && premiereFois) {
    etape.differer("Préparé au premier usage du micro");
    return;
  }

  const totaliser = compteurDeTelechargement();

  const pret = await module.prechargerModele((_etape, _pct, brut) => {
    const cumul = totaliser(brut);
    etape.avancer(cumul);
    // Le libellé suit ce qui se passe réellement. Une fois les octets reçus, il
    // reste l'instanciation du graphe ONNX — quelques secondes pendant
    // lesquelles rien ne progresse, et où « téléchargement » serait faux.
    // Dire « téléchargement » alors que les octets sortent du cache de
    // l'appareil ferait croire à un rechargement complet à chaque ouverture —
    // et donnerait à l'application l'air de gaspiller le forfait de son
    // utilisateur, ce qu'elle ne fait pas.
    etape.dire(
      cumul && cumul.charge < cumul.total
        ? premiereFois
          ? "Téléchargement du modèle, une seule fois sur cet appareil…"
          : "Reprise du modèle déjà présent sur l'appareil…"
        : "Mise en place du moteur de transcription…"
    );
  });

  if (pret) {
    etape.reussir();
    return;
  }

  // Les explications de `transcription.js` sont écrites pour suivre « La dictée
  // a échoué : » et commencent donc en minuscule. Ici elles tiennent seules.
  const raison = module.raisonEchecPreparation();
  etape.echouer(
    raison
      ? raison.charAt(0).toUpperCase() + raison.slice(1)
      : "La dictée n'a pas pu être préparée sur ce poste. Vous pouvez écrire au clavier."
  );
}
