/**
 * Diagnostic du poste.
 *
 * Cette page existe à cause d'une journée perdue. Un éducateur signale « la
 * dictée a échoué : Failed to fetch » ; le message ne dit ni si le navigateur
 * est trop ancien, ni si le proxy de l'établissement bloque le téléchargement
 * du modèle, ni si le serveur a été déployé sans la bibliothèque. Il a fallu
 * reproduire, instrumenter, écarter des hypothèses une à une. Les mêmes
 * contrôles, exécutés sur le poste concerné, auraient répondu en dix secondes.
 *
 * Trois règles de conception :
 *
 *  - accessible sans être connecté, puisque ne pas pouvoir se connecter est
 *    précisément l'un des incidents à diagnostiquer ;
 *  - aucun verdict deviné : ce qui n'a pas pu être vérifié est annoncé comme
 *    tel, jamais présenté comme bon ;
 *  - un rapport copiable en un bouton, parce que la personne qui constate la
 *    panne n'est pas celle qui la corrigera.
 */

const CONTROLES = [];
const resultats = [];

/** Verdicts, du plus grave au plus anodin. */
const BLOQUANT = "bloquant";
const LIMITE = "limite";
const BON = "bon";
const INCONNU = "inconnu";

const LIBELLES = {
  [BLOQUANT]: "Bloquant",
  [LIMITE]: "Limite",
  [BON]: "Bon",
  [INCONNU]: "Non vérifié",
};

function controle(groupe, intitule, execute) {
  CONTROLES.push({ groupe, intitule, execute });
}

/** Un contrôle rend toujours un verdict et une phrase qui l'explique. */
function verdict(etat, detail, conseil) {
  return { etat, detail, conseil };
}

// --- Navigateur -------------------------------------------------------------

controle("Navigateur", "Identité", () => {
  const ua = navigator.userAgent;
  const connu =
    /Edg\/[\d.]+/.exec(ua) ||
    /Chrome\/[\d.]+/.exec(ua) ||
    /Firefox\/[\d.]+/.exec(ua) ||
    /Version\/[\d.]+ Safari/.exec(ua);
  return verdict(BON, connu ? connu[0] : ua.slice(0, 80));
});

controle("Navigateur", "Modules JavaScript", () => {
  // Cette page s'exécute : si les modules manquaient, rien ne s'afficherait.
  // Le contrôle vaut pour le rapport, pas pour la page.
  const supporte = "noModule" in HTMLScriptElement.prototype;
  return supporte
    ? verdict(BON, "pris en charge")
    : verdict(BLOQUANT, "absents", "Navigateur trop ancien pour l'application.");
});

controle("Navigateur", "Fenêtres modales", () => {
  const supporte = typeof HTMLDialogElement !== "undefined" &&
    typeof HTMLDialogElement.prototype.showModal === "function";
  return supporte
    ? verdict(BON, "élément <dialog> disponible")
    : verdict(
        BLOQUANT,
        "élément <dialog> absent",
        "Les réglages et les formulaires ne s'ouvriront pas."
      );
});

controle("Navigateur", "Sélecteurs modernes", () => {
  let supporte = false;
  try {
    supporte = CSS.supports("selector(:has(*))");
  } catch {
    supporte = false;
  }
  return supporte
    ? verdict(BON, ":has() pris en charge")
    : verdict(LIMITE, ":has() absent", "Certains détails d'affichage seront approximatifs.");
});

controle("Navigateur", "Copie de structures", () =>
  typeof structuredClone === "function"
    ? verdict(BON, "structuredClone disponible")
    : verdict(
        BLOQUANT,
        "structuredClone absent",
        "La reprise d'un bilan précédent échouera."
      )
);

// --- Poste ------------------------------------------------------------------

controle("Poste", "Origine sécurisée", () => {
  if (window.isSecureContext) {
    // Un rapport où figure « http…  BON » se lit comme une contradiction : on
    // dit donc pourquoi c'est accepté.
    const raison =
      location.protocol === "https:"
        ? "page chiffrée"
        : "application ouverte sur ce poste même, ce que le navigateur accepte";
    return verdict(BON, `${location.protocol}//${location.host} — ${raison}`);
  }
  return verdict(
    BLOQUANT,
    `page servie en ${location.protocol}`,
    "Le navigateur réserve le micro aux origines sécurisées : la dictée ne " +
      "fonctionnera pas. Utilisez l'adresse en https, ou l'application sur ce poste."
  );
});

controle("Poste", "Écran", () => {
  const l = window.innerWidth;
  const h = window.innerHeight;
  const zoom = Math.round(window.devicePixelRatio * 100) / 100;
  const detail = `${l} × ${h} px utiles, densité ${zoom}`;

  if (h >= 700 && l >= 1280) return verdict(BON, detail);
  if (h >= 600) {
    return verdict(
      LIMITE,
      detail,
      "Une étape de parcours guidé peut demander à défiler. Réduire le zoom du " +
        "navigateur (Ctrl et -) rend l'écran plus confortable."
    );
  }
  return verdict(
    LIMITE,
    detail,
    "Écran trop court pour afficher une étape entière ; le défilement sera fréquent."
  );
});

controle("Poste", "Mémoire et cœurs", () => {
  const memoire = navigator.deviceMemory;
  const coeurs = navigator.hardwareConcurrency;
  const detail = `${memoire ? `${memoire} Go` : "mémoire inconnue"}, ${
    coeurs ? `${coeurs} cœurs` : "nombre de cœurs inconnu"
  }`;
  if (memoire && memoire <= 4) {
    return verdict(
      LIMITE,
      detail,
      "La dictée fonctionnera, mais lentement : le modèle est calculé sur ce poste."
    );
  }
  return verdict(memoire || coeurs ? BON : INCONNU, detail);
});

controle("Poste", "Espace de stockage", async () => {
  if (!navigator.storage || !navigator.storage.estimate) {
    return verdict(INCONNU, "non mesurable sur ce navigateur");
  }
  const { quota = 0, usage = 0 } = await navigator.storage.estimate();
  const libre = Math.round((quota - usage) / 1e6);
  const detail = `${libre} Mo disponibles pour le navigateur`;
  // Le modèle de dictée pèse environ 150 Mo, mis en cache après le premier usage.
  if (libre < 300) {
    return verdict(
      LIMITE,
      detail,
      "Le modèle de dictée occupe environ 150 Mo : il devra être retéléchargé " +
        "souvent si la place manque."
    );
  }
  return verdict(BON, detail);
});

// --- Dictée -----------------------------------------------------------------

controle("Dictée vocale", "Micro", async () => {
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    return verdict(
      BLOQUANT,
      "l'enregistrement n'est pas disponible",
      "Navigateur trop ancien, ou page servie sans origine sécurisée."
    );
  }
  try {
    const appareils = await navigator.mediaDevices.enumerateDevices();
    const entrees = appareils.filter((a) => a.kind === "audioinput");
    if (entrees.length === 0) {
      return verdict(
        BLOQUANT,
        "aucun micro détecté",
        "Brancher un casque ou un micro, puis relancer ce diagnostic."
      );
    }
    return verdict(BON, `${entrees.length} entrée(s) audio détectée(s)`);
  } catch {
    return verdict(INCONNU, "liste des appareils refusée par le navigateur");
  }
});

controle("Dictée vocale", "Calcul du modèle", () => {
  const wasm = typeof WebAssembly === "object";
  const webgpu = "gpu" in navigator;
  if (!wasm) {
    return verdict(
      BLOQUANT,
      "WebAssembly indisponible",
      "Le moteur de transcription ne peut pas s'exécuter."
    );
  }
  return webgpu
    ? verdict(BON, "WebGPU disponible — transcription rapide")
    : verdict(
        LIMITE,
        "WebGPU absent, calcul sur le processeur",
        "La transcription fonctionnera, plus lentement."
      );
});

controle("Dictée vocale", "Bibliothèque sur le serveur", async () => {
  try {
    const reponse = await fetch("/vendor/transformers.min.js", { method: "HEAD" });
    return reponse.ok
      ? verdict(BON, "installée")
      : verdict(
          BLOQUANT,
          `absente (${reponse.status})`,
          "Le serveur a été déployé sans elle : la correction est côté serveur."
        );
  } catch {
    return verdict(INCONNU, "serveur injoignable");
  }
});

controle("Dictée vocale", "Téléchargement du modèle", async () => {
  // Le premier usage récupère les poids depuis Hugging Face. Un proxy
  // d'établissement qui filtre les domaines inconnus les bloque, et l'erreur
  // n'apparaît qu'au clic sur le micro.
  const joignable = await accessible(
    "https://huggingface.co/onnx-community/whisper-base/resolve/main/config.json"
  );
  if (joignable === true) return verdict(BON, "huggingface.co joignable");
  if (joignable === null) return verdict(INCONNU, "vérification impossible");
  return verdict(
    BLOQUANT,
    "huggingface.co inaccessible depuis ce poste",
    "Réseau de l'établissement filtrant, très probablement. La dictée ne " +
      "pourra pas télécharger son modèle tant que ce domaine est bloqué."
  );
});

controle("Dictée vocale", "Moteur d'inférence", async () => {
  const joignable = await accessible("https://cdn.jsdelivr.net/npm/onnxruntime-web/package.json");
  if (joignable === true) return verdict(BON, "cdn.jsdelivr.net joignable");
  if (joignable === null) return verdict(INCONNU, "vérification impossible");
  return verdict(
    BLOQUANT,
    "cdn.jsdelivr.net inaccessible depuis ce poste",
    "Le moteur de transcription est chargé depuis ce domaine au premier usage."
  );
});

// --- Serveur ----------------------------------------------------------------

controle("Serveur", "Réponse et base de données", async () => {
  try {
    const debut = performance.now();
    const reponse = await fetch("/health", { cache: "no-store" });
    const duree = Math.round(performance.now() - debut);
    const donnees = await reponse.json();
    etatServeur.version = donnees.version;

    if (donnees.status === "ok") {
      return verdict(BON, `répond en ${duree} ms, base joignable`);
    }
    return verdict(
      BLOQUANT,
      "l'application répond mais sa base de données est injoignable",
      "Rien ne pourra être enregistré. La correction est côté serveur."
    );
  } catch {
    return verdict(
      BLOQUANT,
      "aucune réponse",
      "Serveur arrêté, ou poste sans accès au réseau."
    );
  }
});

controle("Serveur", "Version déployée", () =>
  etatServeur.version
    ? verdict(BON, etatServeur.version)
    : verdict(INCONNU, "non communiquée")
);

const etatServeur = { version: null };

/**
 * Un domaine répond-il ? `no-cors` suffit : on ne lit pas la réponse, on
 * cherche seulement à savoir si la requête sort du réseau. Une réponse opaque
 * est donc un succès.
 */
async function accessible(url) {
  const abandon = new AbortController();
  const minuteur = setTimeout(() => abandon.abort(), 8000);
  try {
    await fetch(url, { mode: "no-cors", signal: abandon.signal, cache: "no-store" });
    return true;
  } catch (err) {
    return err.name === "AbortError" ? false : false;
  } finally {
    clearTimeout(minuteur);
  }
}

// --- Exécution et rendu -----------------------------------------------------

function ligne(groupe, intitule, resultat) {
  const bloc = document.createElement("div");
  bloc.className = `controle controle-${resultat.etat}`;

  const titre = document.createElement("div");
  titre.className = "controle-intitule";
  titre.textContent = intitule;

  const etat = document.createElement("span");
  etat.className = `controle-etat etat-${resultat.etat}`;
  etat.textContent = LIBELLES[resultat.etat];

  const detail = document.createElement("div");
  detail.className = "controle-detail";
  detail.textContent = resultat.detail;

  bloc.append(titre, etat, detail);

  if (resultat.conseil) {
    const conseil = document.createElement("div");
    conseil.className = "controle-conseil";
    conseil.textContent = resultat.conseil;
    bloc.append(conseil);
  }

  document.querySelector(`[data-groupe="${groupe}"] .controles`).append(bloc);
}

function majSynthese() {
  const bloquants = resultats.filter((r) => r.etat === BLOQUANT);
  const limites = resultats.filter((r) => r.etat === LIMITE);
  const synthese = document.getElementById("synthese");

  if (bloquants.length > 0) {
    synthese.className = "synthese synthese-bloquant";
    synthese.textContent =
      `${bloquants.length} point${bloquants.length > 1 ? "s" : ""} bloquant${
        bloquants.length > 1 ? "s" : ""
      } : ` + bloquants.map((r) => r.intitule.toLowerCase()).join(", ") + ".";
    return;
  }
  if (limites.length > 0) {
    synthese.className = "synthese synthese-limite";
    synthese.textContent =
      "Ce poste peut travailler, avec des limites : " +
      limites.map((r) => r.intitule.toLowerCase()).join(", ") + ".";
    return;
  }
  synthese.className = "synthese synthese-bon";
  synthese.textContent = "Ce poste réunit tout ce dont l'application a besoin.";
}

function rapportTexte() {
  const lignes = [
    `Diagnostic du poste — ${new Date().toLocaleString("fr-FR")}`,
    `Adresse : ${location.origin}`,
    `Version de l'application : ${etatServeur.version ?? "inconnue"}`,
    "",
  ];
  let groupeCourant = null;
  for (const r of resultats) {
    if (r.groupe !== groupeCourant) {
      groupeCourant = r.groupe;
      lignes.push(`— ${groupeCourant} —`);
    }
    lignes.push(
      `[${LIBELLES[r.etat]}] ${r.intitule} : ${r.detail}` +
        (r.conseil ? `\n         ${r.conseil}` : "")
    );
  }
  lignes.push("", `Navigateur : ${navigator.userAgent}`);
  return lignes.join("\n");
}

/**
 * Ajoute au rapport un contrôle exécuté après coup, à sa place.
 *
 * L'ordre du rapport suit les groupes : un résultat ajouté à la fin se lirait
 * sous « Serveur », loin de ce dont il parle.
 */
function ajouterResultat(groupe, intitule, resultat) {
  const dernier = resultats.map((r) => r.groupe).lastIndexOf(groupe);
  const entree = { groupe, intitule, ...resultat };
  if (dernier === -1) {
    resultats.push(entree);
  } else {
    resultats.splice(dernier + 1, 0, entree);
  }
  ligne(groupe, intitule, resultat);
  majSynthese();
}

/**
 * Essai réel : charge le modèle et l'exécute.
 *
 * Séparé des contrôles automatiques parce qu'il télécharge cent quarante
 * mégaoctets. C'est pourtant le seul qui distingue « tout est joignable » de
 * « la dictée fonctionne » — un pilote graphique peut construire le graphe
 * puis refuser de l'exécuter, et alors tout le reste du rapport est vert.
 */
function brancherEssaiDictee() {
  const bouton = document.getElementById("essai-dictee");
  const etat = document.getElementById("essai-etat");
  bouton.disabled = false;

  bouton.addEventListener("click", async () => {
    bouton.disabled = true;
    etat.textContent = "Essai en cours…";

    try {
      const module = await import("/transcription.js");
      const { peripherique, dureeMs } = await module.essaiTechnique(
        (etape, pct) => {
          etat.textContent = pct === undefined ? etape : `${etape} ${pct} %`;
        }
      );
      etat.textContent = "";
      ajouterResultat(
        "Dictée vocale",
        "Essai réel de transcription",
        verdict(
          BON,
          `le modèle s'exécute (${peripherique}, ${Math.round(dureeMs)} ms pour 1 s d'audio)`
        )
      );
    } catch (err) {
      etat.textContent = "";
      ajouterResultat(
        "Dictée vocale",
        "Essai réel de transcription",
        verdict(
          BLOQUANT,
          err.message,
          "La dictée échouera sur ce poste. Copiez le rapport et transmettez-le."
        )
      );
    } finally {
      bouton.hidden = true;
    }
  });
}

async function lancer() {
  document.getElementById("controles-vides").hidden = true;

  for (const { groupe, intitule, execute } of CONTROLES) {
    let resultat;
    try {
      resultat = await execute();
    } catch (err) {
      resultat = verdict(INCONNU, `contrôle interrompu : ${err.message}`);
    }
    resultats.push({ groupe, intitule, ...resultat });
    ligne(groupe, intitule, resultat);
    majSynthese();
  }

  brancherEssaiDictee();

  document.getElementById("copier").hidden = false;
  document.getElementById("copier").addEventListener("click", async () => {
    const bouton = document.getElementById("copier");
    try {
      await navigator.clipboard.writeText(rapportTexte());
      bouton.textContent = "Rapport copié";
    } catch {
      // Presse-papiers refusé : on montre le texte, la personne le sélectionne.
      const zone = document.getElementById("rapport");
      zone.value = rapportTexte();
      zone.hidden = false;
      zone.select();
      bouton.textContent = "Copiez le texte ci-dessous";
    }
    setTimeout(() => (bouton.textContent = "Copier le rapport"), 4000);
  });
}

lancer();
