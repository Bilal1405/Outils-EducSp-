/**
 * Comparaison des précisions de Whisper, sur la voix et le matériel réels.
 *
 * L'application télécharge aujourd'hui le modèle en pleine précision : environ
 * 140 Mo, et une transcription lente sur un poste sans WebGPU. La variante
 * quantifiée « q8 » divise le téléchargement par trois environ et accélère
 * l'inférence, au prix d'une fidélité moindre.
 *
 * « Moindre » de combien ? Aucune réponse générale ne vaut : cela dépend du
 * micro, de l'accent, du bruit de la salle et du vocabulaire du métier. Les
 * chiffres publiés sont mesurés sur des corpus de lecture en studio, pas sur
 * un éducateur qui dicte une observation dans un couloir. Cette page fait donc
 * la mesure là où elle a un sens : sur le poste, avec la voix qui s'en servira.
 *
 * L'audio ne quitte pas la machine — c'est déjà vrai de la dictée, et cela
 * reste vrai ici : les deux transcriptions tournent dans cet onglet, rien
 * n'est envoyé au serveur, rien n'est écrit sur disque.
 */
import {
  BIBLIOTHEQUE,
  MODELE,
  OPTIONS_TRANSCRIPTION,
  versPcmMono16k,
} from "/transcription.js";

const $ = (id) => document.getElementById(id);

/**
 * Les deux variantes comparées.
 *
 * `undefined` reproduit exactement ce que fait l'application aujourd'hui — ne
 * pas le remplacer par "fp32" : ce serait imposer un choix là où le code
 * laisse le dépôt décider, et la comparaison ne porterait plus sur la version
 * en service.
 */
const VARIANTES = [
  {
    cle: "actuelle",
    nom: "Pleine précision (en service)",
    dtype: undefined,
  },
  {
    cle: "q8",
    nom: "Quantifiée q8",
    dtype: "q8",
  },
];

let pcm = null;
let dureeAudio = 0;
let enregistreur = null;
let flux = null;
const mesures = new Map();

// --- Audio -------------------------------------------------------------------

function secondes(ms) {
  return `${(ms / 1000).toFixed(1)} s`;
}

function mo(octets) {
  return `${(octets / 1024 / 1024).toFixed(1)} Mo`;
}

function etat(message) {
  $("etat").textContent = message;
}

async function accepterAudio(blob) {
  etat("Décodage de l'enregistrement…");
  try {
    pcm = await versPcmMono16k(blob);
  } catch (err) {
    etat(`Ce fichier n'a pas pu être décodé : ${err.message}`);
    return;
  }
  if (pcm.length === 0) {
    etat("L'enregistrement est vide.");
    pcm = null;
    return;
  }
  dureeAudio = pcm.length / 16000;
  etat(`Enregistrement prêt : ${dureeAudio.toFixed(1)} s de parole.`);
  $("lancer").disabled = false;
}

async function basculerEnregistrement() {
  if (enregistreur && enregistreur.state === "recording") {
    enregistreur.stop();
    return;
  }

  try {
    flux = await navigator.mediaDevices.getUserMedia({ audio: true });
  } catch {
    etat("Accès au micro refusé. Autorisez-le dans les réglages du navigateur.");
    return;
  }

  const format = ["audio/webm", "audio/ogg", "audio/mp4"].find(
    (type) => window.MediaRecorder && MediaRecorder.isTypeSupported(type)
  );
  enregistreur = new MediaRecorder(flux, format ? { mimeType: format } : undefined);
  const morceaux = [];

  enregistreur.addEventListener("dataavailable", (e) => {
    if (e.data.size > 0) morceaux.push(e.data);
  });
  enregistreur.addEventListener("stop", async () => {
    flux.getTracks().forEach((p) => p.stop());
    flux = null;
    $("enregistrer").textContent = "Enregistrer une dictée";
    $("enregistrer").classList.remove("btn-danger");
    await accepterAudio(new Blob(morceaux, { type: enregistreur.mimeType || "audio/webm" }));
  });

  enregistreur.start();
  $("enregistrer").textContent = "Arrêter l'enregistrement";
  $("enregistrer").classList.add("btn-danger");
  etat("Enregistrement… dictez une observation comme vous le feriez dans l'outil.");
}

// --- Mesure ------------------------------------------------------------------

/**
 * Charge une variante et transcrit, en chronométrant séparément les deux
 * phases : elles ne se paient pas au même moment. Le téléchargement n'a lieu
 * qu'une fois par poste ; la transcription, à chaque dictée. Les additionner
 * cacherait celle des deux qui compte vraiment à l'usage.
 */
async function mesurer(variante) {
  const { pipeline, env } = await import(BIBLIOTHEQUE);
  env.allowLocalModels = false;
  env.useBrowserCache = true;

  const fichiers = new Map();
  const progression = (p) => {
    if (p.status === "progress" && p.total) {
      fichiers.set(p.file, p.total);
    }
    const total = [...fichiers.values()].reduce((a, b) => a + b, 0);
    if (total > 0) {
      etat(`${variante.nom} — téléchargement : ${mo(total)}…`);
    }
  };

  const debutChargement = performance.now();
  let transcripteur;
  let peripherique = "wasm";
  let derniere;
  for (const device of ["webgpu", "wasm"]) {
    try {
      transcripteur = await pipeline("automatic-speech-recognition", MODELE, {
        device,
        dtype: variante.dtype,
        progress_callback: progression,
      });
      peripherique = device;
      break;
    } catch (err) {
      derniere = err;
    }
  }
  if (!transcripteur) throw derniere;
  const chargementMs = performance.now() - debutChargement;

  etat(`${variante.nom} — transcription…`);
  const debutTranscription = performance.now();
  const resultat = await transcripteur(pcm, OPTIONS_TRANSCRIPTION);
  const transcriptionMs = performance.now() - debutTranscription;

  // Libère la session ONNX : deux modèles complets tenus en mémoire en même
  // temps font échouer la seconde variante sur un poste modeste — précisément
  // le poste dont on cherche à savoir s'il tiendra.
  if (typeof transcripteur.dispose === "function") {
    await transcripteur.dispose();
  }

  return {
    texte: (resultat?.text ?? "").trim(),
    chargementMs,
    transcriptionMs,
    peripherique,
    octets: [...fichiers.values()].reduce((a, b) => a + b, 0),
  };
}

// --- Comparaison des textes --------------------------------------------------

/** Découpe en mots comparables : casse et ponctuation ne sont pas le sujet. */
function mots(texte) {
  return texte
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter(Boolean);
}

/**
 * Distance de Levenshtein au mot, entre les deux transcriptions.
 *
 * Ce n'est pas un taux d'erreur : il n'y a pas de vérité de référence — ni
 * l'une ni l'autre des transcriptions n'est « la bonne ». C'est une mesure
 * d'écart, qui répond à la seule question qu'on se pose ici : les deux disent-
 * elles la même chose ? La lecture des textes côte à côte tranche le reste.
 */
function ecart(a, b) {
  const x = mots(a);
  const y = mots(b);
  const d = Array.from({ length: x.length + 1 }, (_, i) =>
    Array.from({ length: y.length + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0))
  );

  for (let i = 1; i <= x.length; i++) {
    for (let j = 1; j <= y.length; j++) {
      d[i][j] =
        x[i - 1] === y[j - 1]
          ? d[i - 1][j - 1]
          : 1 + Math.min(d[i - 1][j], d[i][j - 1], d[i - 1][j - 1]);
    }
  }
  return { differences: d[x.length][y.length], mots: Math.max(x.length, y.length) };
}

// --- Rendu -------------------------------------------------------------------

function ligne(libelle, valeur) {
  const tr = document.createElement("tr");
  const th = document.createElement("th");
  th.scope = "row";
  th.textContent = libelle;
  tr.append(th);
  for (const v of valeur) {
    const td = document.createElement("td");
    td.textContent = v;
    tr.append(td);
  }
  return tr;
}

function afficherResultats() {
  const a = mesures.get("actuelle");
  const b = mesures.get("q8");
  const corps = $("tableau-corps");
  corps.replaceChildren();

  corps.append(
    ligne("Poids téléchargés", [mo(a.octets), mo(b.octets)]),
    ligne("Chargement du modèle", [secondes(a.chargementMs), secondes(b.chargementMs)]),
    ligne("Transcription", [secondes(a.transcriptionMs), secondes(b.transcriptionMs)]),
    ligne("Temps réel", [
      `× ${(a.transcriptionMs / 1000 / dureeAudio).toFixed(2)}`,
      `× ${(b.transcriptionMs / 1000 / dureeAudio).toFixed(2)}`,
    ]),
    ligne("Exécution", [a.peripherique, b.peripherique])
  );

  $("texte-actuelle").textContent = a.texte;
  $("texte-q8").textContent = b.texte;

  const e = ecart(a.texte, b.texte);
  const pct = e.mots ? Math.round((e.differences / e.mots) * 100) : 0;

  if (e.differences > 0) {
    $("ecart").textContent =
      `${e.differences} mot(s) d'écart sur ${e.mots} — soit ${pct} %. ` +
      "Lisez les deux textes : un écart sur un mot outil ne pèse pas comme " +
      "un écart sur un prénom ou une observation.";
  } else if (a.texte === b.texte) {
    $("ecart").textContent = "Les deux transcriptions sont identiques, caractère pour caractère.";
  } else {
    // Annoncer « identiques » à côté de deux textes visiblement différents
    // ferait douter de la mesure elle-même. La comparaison ignore la
    // ponctuation, les accents et la casse — c'est voulu, mais il faut le dire
    // là où l'œil voit autre chose.
    $("ecart").textContent =
      "Mêmes mots de part et d'autre : seules la ponctuation, la casse ou les " +
      "accents diffèrent. Ces écarts-là se corrigent à la relecture sans " +
      "changer le sens.";
  }

  $("resultats").hidden = false;
  $("copier").hidden = false;
}

function rapport() {
  const a = mesures.get("actuelle");
  const b = mesures.get("q8");
  const e = ecart(a.texte, b.texte);
  return [
    `Comparaison des précisions — ${MODELE}`,
    `Poste : ${navigator.userAgent}`,
    `Durée de l'audio : ${dureeAudio.toFixed(1)} s`,
    "",
    ...VARIANTES.map((v) => {
      const m = mesures.get(v.cle);
      return [
        `${v.nom} (${v.dtype ?? "défaut du dépôt"}) — ${m.peripherique}`,
        `  poids : ${mo(m.octets)}`,
        `  chargement : ${secondes(m.chargementMs)}`,
        `  transcription : ${secondes(m.transcriptionMs)} (× ${(m.transcriptionMs / 1000 / dureeAudio).toFixed(2)} temps réel)`,
        `  texte : ${m.texte}`,
      ].join("\n");
    }),
    "",
    `Écart : ${e.differences} mot(s) sur ${e.mots}`,
  ].join("\n");
}

async function lancer() {
  $("lancer").disabled = true;
  $("enregistrer").disabled = true;
  $("fichier").disabled = true;
  mesures.clear();

  try {
    for (const variante of VARIANTES) {
      mesures.set(variante.cle, await mesurer(variante));
    }
    etat("Comparaison terminée.");
    afficherResultats();
  } catch (err) {
    etat(
      `La comparaison n'a pas abouti : ${err.message}. ` +
        "Si le téléchargement est en cause, ouvrez /diagnostic.html."
    );
  } finally {
    $("enregistrer").disabled = false;
    $("fichier").disabled = false;
    $("lancer").disabled = pcm === null;
  }
}

// --- Branchement -------------------------------------------------------------

$("enregistrer").addEventListener("click", basculerEnregistrement);
$("fichier").addEventListener("change", (e) => {
  const fichier = e.target.files[0];
  if (fichier) accepterAudio(fichier);
});
$("lancer").addEventListener("click", lancer);
$("copier").addEventListener("click", async () => {
  const texte = rapport();
  try {
    await navigator.clipboard.writeText(texte);
    $("copier").textContent = "Rapport copié";
  } catch {
    // Presse-papiers refusé (origine non sécurisée) : on montre le texte, il
    // reste sélectionnable à la main.
    $("rapport").value = texte;
    $("rapport").hidden = false;
  }
});
