const els = {
  patientList: document.getElementById("patient-list"),
  nouveauPatientBtn: document.getElementById("nouveau-patient-btn"),
  ficheEmptyState: document.getElementById("empty-state"),
  fiche: document.getElementById("fiche"),
  ficheTitre: document.getElementById("fiche-titre"),
  patientForm: document.getElementById("patient-form"),
  patientNom: document.getElementById("patient-nom"),
  patientPrenom: document.getElementById("patient-prenom"),
  patientDateNaissance: document.getElementById("patient-date-naissance"),
  patientSave: document.getElementById("patient-save"),
  patientStatut: document.getElementById("patient-statut"),
  generationCard: document.getElementById("generation-card"),
  periodeDebut: document.getElementById("periode-debut"),
  periodeFin: document.getElementById("periode-fin"),
  saisie: document.getElementById("saisie"),
  micBtn: document.getElementById("mic-btn"),
  micIcon: document.getElementById("mic-icon"),
  micStatut: document.getElementById("mic-statut"),
  genererBtn: document.getElementById("generer-btn"),
  generationStatut: document.getElementById("generation-statut"),
  resultatSection: document.getElementById("resultat-section"),
  resultatTitre: document.getElementById("resultat-titre"),
  resultatBadge: document.getElementById("resultat-badge"),
  resultatExport: document.getElementById("resultat-export"),
  resultat: document.getElementById("resultat"),
  resultatJson: document.getElementById("resultat-json"),
  resultatJsonDetails: document.getElementById("resultat-json-details"),
  resultatEdition: document.getElementById("resultat-edition"),
  resultatJsonEdit: document.getElementById("resultat-json-edit"),
  resultatEnregistrer: document.getElementById("resultat-enregistrer"),
  resultatValider: document.getElementById("resultat-valider"),
  resultatEditionStatut: document.getElementById("resultat-edition-statut"),
  resultatFermer: document.getElementById("resultat-fermer"),
  historiqueCard: document.getElementById("historique-card"),
  historiqueList: document.getElementById("historique-list"),
  historiqueVide: document.getElementById("historique-vide"),
  etablissementSelect: document.getElementById("etablissement-select"),
  etablissementRefresh: document.getElementById("etablissement-refresh"),
  etablissementCreate: document.getElementById("etablissement-create"),
  etablissementNom: document.getElementById("etablissement-nom"),
  etablissementQuota: document.getElementById("etablissement-quota"),
  quotaAffichage: document.getElementById("quota-affichage"),
  auteurSelect: document.getElementById("auteur-select"),
  auteurRefresh: document.getElementById("auteur-refresh"),
  auteurCreate: document.getElementById("auteur-create"),
  auteurNom: document.getElementById("auteur-nom"),
  auteurPrenom: document.getElementById("auteur-prenom"),
  auteurEmail: document.getElementById("auteur-email"),
};

const state = {
  patients: [],
  selectedPatientId: null, // null = rien sélectionné, "new" = création
  currentBilanId: null,
  currentBilanStatut: null,
};

async function fetchJson(url, options) {
  const response = await fetch(url, options);
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    const detail = data && data.error ? data.error : `Erreur ${response.status}`;
    throw new Error(detail);
  }
  return data;
}

function el(tag, text) {
  const node = document.createElement(tag);
  if (text !== undefined) {
    node.textContent = text;
  }
  return node;
}

function setStatut(target, message, kind) {
  target.textContent = message ?? "";
  target.className = "statut" + (kind ? " " + kind : "");
}

// --- Établissement (cloisonnement + quota) ---

function fillEtablissementSelect(items) {
  const previous =
    els.etablissementSelect.value || localStorage.getItem("etablissementId") || "";
  els.etablissementSelect.innerHTML = "";
  if (items.length === 0) {
    const opt = el("option", "(aucun — ajoutez-en un ci-dessous)");
    opt.value = "";
    els.etablissementSelect.appendChild(opt);
    return;
  }
  for (const item of items) {
    const opt = el("option", item.nom);
    opt.value = item.id;
    els.etablissementSelect.appendChild(opt);
  }
  if (previous && items.some((i) => i.id === previous)) {
    els.etablissementSelect.value = previous;
  }
}

async function loadEtablissements(selectId) {
  const etablissements = await fetchJson("/api/etablissements");
  fillEtablissementSelect(etablissements);
  if (selectId) {
    els.etablissementSelect.value = selectId;
  }
  if (els.etablissementSelect.value) {
    localStorage.setItem("etablissementId", els.etablissementSelect.value);
  }
  await loadQuota();
}

// Quota visible en permanence (BRIEF_PROJET §6).
async function loadQuota() {
  const etablissementId = els.etablissementSelect.value;
  if (!etablissementId) {
    els.quotaAffichage.textContent = "";
    return;
  }
  try {
    const quota = await fetchJson(`/api/etablissements/${etablissementId}/quota`);
    afficherQuota(quota);
  } catch (err) {
    els.quotaAffichage.textContent = "";
  }
}

function afficherQuota(quota) {
  els.quotaAffichage.textContent = `Quota bilans : ${quota.restant} restant(s) / ${quota.quota_mensuel} ce mois-ci`;
  els.quotaAffichage.classList.toggle("quota-epuise", quota.restant <= 0);
}

els.etablissementSelect.addEventListener("change", () => {
  localStorage.setItem("etablissementId", els.etablissementSelect.value);
  loadQuota().catch(() => {});
});

els.etablissementRefresh.addEventListener("click", () => {
  loadEtablissements().catch((err) => setStatut(els.patientStatut, err.message, "error"));
});

els.etablissementCreate.addEventListener("click", async () => {
  const nom = els.etablissementNom.value.trim();
  const quotaValue = els.etablissementQuota.value.trim();
  if (!nom) {
    setStatut(els.patientStatut, "Nom de l'établissement requis", "error");
    return;
  }
  try {
    const body = { nom };
    if (quotaValue) {
      body.quota_mensuel_bilans = Number(quotaValue);
    }
    const created = await fetchJson("/api/etablissements", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    await loadEtablissements(created.id);
    els.etablissementNom.value = "";
    els.etablissementQuota.value = "";
  } catch (err) {
    setStatut(els.patientStatut, err.message, "error");
  }
});

// --- Éducateur (auteur) ---

function fillAuteurSelect(items) {
  const previous = els.auteurSelect.value || localStorage.getItem("auteurId") || "";
  els.auteurSelect.innerHTML = "";
  if (items.length === 0) {
    const opt = el("option", "(aucun — ajoutez-en un ci-dessous)");
    opt.value = "";
    els.auteurSelect.appendChild(opt);
    return;
  }
  for (const item of items) {
    const opt = el("option", `${item.prenom} ${item.nom} (${item.email})`);
    opt.value = item.id;
    els.auteurSelect.appendChild(opt);
  }
  if (previous && items.some((i) => i.id === previous)) {
    els.auteurSelect.value = previous;
  }
}

async function loadUtilisateurs(selectId) {
  const utilisateurs = await fetchJson("/api/utilisateurs");
  fillAuteurSelect(utilisateurs);
  if (selectId) {
    els.auteurSelect.value = selectId;
  }
  if (els.auteurSelect.value) {
    localStorage.setItem("auteurId", els.auteurSelect.value);
  }
}

els.auteurSelect.addEventListener("change", () => {
  localStorage.setItem("auteurId", els.auteurSelect.value);
});

els.auteurRefresh.addEventListener("click", () => {
  loadUtilisateurs().catch((err) => setStatut(els.generationStatut, err.message, "error"));
});

els.auteurCreate.addEventListener("click", async () => {
  const nom = els.auteurNom.value.trim();
  const prenom = els.auteurPrenom.value.trim();
  const email = els.auteurEmail.value.trim();
  if (!nom || !prenom || !email) {
    setStatut(els.generationStatut, "Nom, prénom et email de l'éducateur requis", "error");
    return;
  }
  try {
    const created = await fetchJson("/api/utilisateurs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ nom, prenom, email }),
    });
    await loadUtilisateurs(created.id);
    els.auteurNom.value = "";
    els.auteurPrenom.value = "";
    els.auteurEmail.value = "";
  } catch (err) {
    setStatut(els.generationStatut, err.message, "error");
  }
});

// --- Sidebar patients ---

function renderPatientList() {
  els.patientList.innerHTML = "";
  if (state.patients.length === 0) {
    els.patientList.appendChild(el("p", "Aucun patient — créez-en un.")).className =
      "patient-item-empty";
    return;
  }
  for (const patient of state.patients) {
    const btn = el("button", null);
    btn.type = "button";
    btn.className =
      "patient-item" + (state.selectedPatientId === patient.id ? " active" : "");
    const nomEl = el("span", `${patient.prenom} ${patient.nom}`);
    nomEl.className = "patient-item-nom";
    btn.appendChild(nomEl);
    btn.addEventListener("click", () => selectPatient(patient.id));
    els.patientList.appendChild(btn);
  }
}

async function loadPatients() {
  state.patients = await fetchJson("/api/patients");
  renderPatientList();
}

els.nouveauPatientBtn.addEventListener("click", () => {
  selectPatient("new");
});

async function selectPatient(id) {
  state.selectedPatientId = id;
  renderPatientList();
  stopRecordingIfActive();
  hideResultat();
  setStatut(els.patientStatut, "");
  setStatut(els.generationStatut, "");
  els.saisie.value = "";

  if (id === "new") {
    els.ficheEmptyState.hidden = true;
    els.fiche.hidden = false;
    els.ficheTitre.textContent = "Nouveau patient";
    els.patientNom.value = "";
    els.patientPrenom.value = "";
    els.patientDateNaissance.value = "";
    els.patientSave.textContent = "Créer le patient";
    els.generationCard.hidden = true;
    els.historiqueCard.hidden = true;
    els.patientNom.focus();
    return;
  }

  if (!id) {
    els.ficheEmptyState.hidden = false;
    els.fiche.hidden = true;
    return;
  }

  els.ficheEmptyState.hidden = true;
  els.fiche.hidden = false;
  els.patientSave.textContent = "Enregistrer le profil";
  els.generationCard.hidden = false;
  els.historiqueCard.hidden = false;

  try {
    const patient = await fetchJson(`/api/patients/${id}`);
    els.ficheTitre.textContent = `${patient.prenom} ${patient.nom}`;
    els.patientNom.value = patient.nom;
    els.patientPrenom.value = patient.prenom;
    els.patientDateNaissance.value = patient.date_naissance
      ? patient.date_naissance.slice(0, 10)
      : "";
  } catch (err) {
    setStatut(els.patientStatut, err.message, "error");
  }

  loadHistorique(id).catch((err) => setStatut(els.generationStatut, err.message, "error"));
}

els.patientForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const nom = els.patientNom.value.trim();
  const prenom = els.patientPrenom.value.trim();
  const dateNaissance = els.patientDateNaissance.value || null;

  if (!nom || !prenom) {
    setStatut(els.patientStatut, "Nom et prénom requis", "error");
    return;
  }

  const etablissementId = els.etablissementSelect.value;
  if (state.selectedPatientId === "new" && !etablissementId) {
    setStatut(els.patientStatut, "Sélectionnez ou ajoutez un établissement (sidebar)", "error");
    return;
  }

  els.patientSave.disabled = true;
  try {
    if (state.selectedPatientId === "new") {
      const created = await fetchJson("/api/patients", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          nom,
          prenom,
          date_naissance: dateNaissance,
          etablissement_id: etablissementId,
        }),
      });
      await loadPatients();
      setStatut(els.patientStatut, "Patient créé", "ok");
      await selectPatient(created.id);
    } else {
      await fetchJson(`/api/patients/${state.selectedPatientId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ nom, prenom, date_naissance: dateNaissance }),
      });
      await loadPatients();
      els.ficheTitre.textContent = `${prenom} ${nom}`;
      setStatut(els.patientStatut, "Profil mis à jour", "ok");
    }
  } catch (err) {
    setStatut(els.patientStatut, err.message, "error");
  } finally {
    els.patientSave.disabled = false;
  }
});

// --- Historique des bilans ---

function formatDate(isoDate) {
  if (!isoDate) return "";
  const [year, month, day] = isoDate.slice(0, 10).split("-");
  return `${day}/${month}/${year}`;
}

function statutBadge(statut) {
  const badge = el("span", statut);
  badge.className = "badge " + (statut === "validé" ? "badge-valide" : "badge-brouillon");
  return badge;
}

async function loadHistorique(patientId) {
  const bilans = await fetchJson(`/api/patients/${patientId}/bilans`);
  els.historiqueList.innerHTML = "";
  els.historiqueVide.hidden = bilans.length > 0;

  for (const bilan of bilans) {
    const btn = el("button", null);
    btn.type = "button";
    btn.className = "historique-item";

    const periode = el(
      "span",
      `${formatDate(bilan.periode_debut)} → ${formatDate(bilan.periode_fin)}`
    );
    periode.className = "historique-item-periode";
    btn.appendChild(periode);

    const source = bilan.source === "audio" ? "🎤 audio" : "texte";
    const meta = el("span", `généré le ${new Date(bilan.date_generation).toLocaleDateString("fr-FR")} · ${source}`);
    meta.className = "historique-item-meta";
    btn.appendChild(meta);

    btn.appendChild(statutBadge(bilan.statut));

    btn.addEventListener("click", () => openBilan(bilan.id));
    els.historiqueList.appendChild(btn);
  }
}

async function openBilan(id) {
  try {
    const bilan = await fetchJson(`/api/bilans/${id}`);
    afficherBilan(bilan);
  } catch (err) {
    setStatut(els.generationStatut, err.message, "error");
  }
}

els.resultatFermer.addEventListener("click", hideResultat);

function hideResultat() {
  els.resultatSection.hidden = true;
  state.currentBilanId = null;
  state.currentBilanStatut = null;
}

/**
 * Affiche un bilan (fraîchement généré ou rouvert depuis l'historique) et
 * bascule l'écran édition/validation selon son statut (BRIEF_PROJET §6) :
 * un brouillon reste modifiable, un bilan validé est en lecture seule
 * (archivage définitif).
 */
function afficherBilan(bilan) {
  state.currentBilanId = bilan.id;
  state.currentBilanStatut = bilan.statut;

  els.resultatTitre.textContent = `Bilan ${formatDate(bilan.periode_debut)} → ${formatDate(bilan.periode_fin)}`;
  els.resultatBadge.textContent = bilan.statut;
  els.resultatBadge.className =
    "badge " + (bilan.statut === "validé" ? "badge-valide" : "badge-brouillon");
  els.resultatExport.href = `/api/bilans/${bilan.id}/export.docx`;
  setStatut(els.resultatEditionStatut, "");

  renderBilan(bilan.contenu);

  const estBrouillon = bilan.statut !== "validé";
  els.resultatEdition.hidden = !estBrouillon;
  els.resultatJsonDetails.hidden = estBrouillon;
  if (estBrouillon) {
    els.resultatJsonEdit.value = JSON.stringify(bilan.contenu, null, 2);
  }
}

els.resultatEnregistrer.addEventListener("click", async () => {
  await sauvegarderEdition({ valider: false });
});

els.resultatValider.addEventListener("click", async () => {
  if (!window.confirm("Valider ce bilan ? Il sera archivé définitivement et ne pourra plus être modifié.")) {
    return;
  }
  await sauvegarderEdition({ valider: true });
});

async function sauvegarderEdition({ valider }) {
  if (!state.currentBilanId) return;

  let contenu;
  try {
    contenu = JSON.parse(els.resultatJsonEdit.value);
  } catch (err) {
    setStatut(els.resultatEditionStatut, "JSON invalide : corrigez avant d'enregistrer", "error");
    return;
  }

  els.resultatEnregistrer.disabled = true;
  els.resultatValider.disabled = true;
  setStatut(els.resultatEditionStatut, valider ? "Validation en cours…" : "Enregistrement…", "");

  try {
    const body = { contenu };
    if (valider) {
      body.statut = "validé";
    }
    const updated = await fetchJson(`/api/bilans/${state.currentBilanId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    afficherBilan(updated);
    setStatut(
      els.resultatEditionStatut,
      valider ? "Bilan validé et archivé" : "Modifications enregistrées",
      "ok"
    );
    if (state.selectedPatientId && state.selectedPatientId !== "new") {
      loadHistorique(state.selectedPatientId).catch(() => {});
    }
  } catch (err) {
    setStatut(els.resultatEditionStatut, err.message, "error");
  } finally {
    els.resultatEnregistrer.disabled = false;
    els.resultatValider.disabled = false;
  }
}

// --- Rendu d'un bilan ---

function renderListeDomaine(list, itemsFn) {
  const ul = el("ul");
  for (const item of list) {
    ul.appendChild(el("li", itemsFn(item)));
  }
  return ul;
}

function renderBilan(contenu) {
  els.resultat.innerHTML = "";

  const dl = el("dl");
  const enTete = contenu.en_tete;
  const champs = [
    ["Structure", enTete.structure],
    ["Bénéficiaire", `${enTete.beneficiaire_nom} (${enTete.beneficiaire_age} ans)`],
    ["Période", `${enTete.periode_debut} → ${enTete.periode_fin}`],
    ["Intervenants", enTete.professionnels_intervenants.join(", ")],
    ["Jours / horaires", enTete.jours_heures_intervention],
    ["Lieux", enTete.lieux],
  ];
  for (const [label, value] of champs) {
    dl.appendChild(el("dt", label));
    dl.appendChild(el("dd", value || "—"));
  }
  els.resultat.appendChild(dl);

  els.resultat.appendChild(el("h3", "Objectifs de la période"));
  els.resultat.appendChild(
    renderListeDomaine(
      contenu.objectifs_intervention_periode,
      (o) => `${o.domaine_competence} — ${o.objectif}`
    )
  );

  els.resultat.appendChild(el("h3", "Évaluation des comportements"));
  els.resultat.appendChild(
    renderListeDomaine(
      contenu.evaluation_comportement,
      (c) => `${c.type_comportement} — ${c.frequence}`
    )
  );

  els.resultat.appendChild(el("h3", "Évaluation des objectifs par domaine"));
  els.resultat.appendChild(
    renderListeDomaine(
      contenu.evaluation_objectifs_par_domaine,
      (o) => `${o.domaine_competence} — ${o.observations}`
    )
  );

  if (contenu.autres_observations && contenu.autres_observations.length > 0) {
    els.resultat.appendChild(el("h3", "Autres observations"));
    els.resultat.appendChild(renderListeDomaine(contenu.autres_observations, (o) => o));
  }

  els.resultat.appendChild(el("h3", "Objectifs proposés — période suivante"));
  els.resultat.appendChild(
    renderListeDomaine(
      contenu.proposition_objectifs_periode_suivante,
      (o) => `${o.domaine_competence} — ${o.objectif} (${o.comment})`
    )
  );

  els.resultatJson.textContent = JSON.stringify(contenu, null, 2);
  els.resultatSection.hidden = false;
  els.resultatSection.scrollIntoView({ behavior: "smooth", block: "start" });
}

// --- Génération de bilan ---

els.genererBtn.addEventListener("click", async () => {
  const patientId = state.selectedPatientId;
  const auteurId = els.auteurSelect.value;
  const texte = els.saisie.value.trim();
  const periodeDebut = els.periodeDebut.value;
  const periodeFin = els.periodeFin.value;

  if (!patientId || patientId === "new") {
    setStatut(els.generationStatut, "Enregistrez d'abord le profil du patient", "error");
    return;
  }
  if (!auteurId) {
    setStatut(els.generationStatut, "Sélectionnez ou ajoutez un éducateur", "error");
    return;
  }
  if (!texte) {
    setStatut(els.generationStatut, "Le compte-rendu ne peut pas être vide", "error");
    return;
  }
  if (!periodeDebut || !periodeFin) {
    setStatut(els.generationStatut, "Renseignez la période (début et fin)", "error");
    return;
  }

  els.genererBtn.disabled = true;
  hideResultat();
  setStatut(els.generationStatut, "Génération en cours… (peut prendre quelques secondes)", "");

  try {
    const result = await fetchJson(`/api/patients/${patientId}/bilans/generate`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-user-id": auteurId,
      },
      body: JSON.stringify({
        texte,
        source: saisieDictee ? "audio" : "texte",
        periode_debut: periodeDebut,
        periode_fin: periodeFin,
      }),
    });
    setStatut(els.generationStatut, `Bilan généré (statut: ${result.statut})`, "ok");
    saisieDictee = false;
    afficherBilan({
      id: result.id,
      statut: result.statut,
      contenu: result.contenu,
      periode_debut: periodeDebut,
      periode_fin: periodeFin,
    });
    if (result.quota) {
      afficherQuota(result.quota);
    }
    loadHistorique(patientId).catch(() => {});
  } catch (err) {
    setStatut(els.generationStatut, err.message, "error");
    loadQuota().catch(() => {});
  } finally {
    els.genererBtn.disabled = false;
  }
});

// --- Dictée vocale (MediaRecorder + Whisper dans le navigateur) ---

let mediaRecorder = null;
let audioChunks = [];
let mediaStream = null;
/** Trace l'origine du compte-rendu pour renseigner `source` côté bilan. */
let saisieDictee = false;

function stopRecordingIfActive() {
  if (mediaRecorder && mediaRecorder.state !== "inactive") {
    mediaRecorder.stop();
  }
}

function setMicState(recording) {
  els.micBtn.classList.toggle("recording", recording);
  els.micIcon.textContent = recording ? "⏹" : "🎤";
  els.micBtn.title = recording ? "Arrêter l'enregistrement" : "Dicter au micro";
}

els.micBtn.addEventListener("click", async () => {
  if (mediaRecorder && mediaRecorder.state === "recording") {
    mediaRecorder.stop();
    return;
  }

  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    setStatut(els.generationStatut, "Enregistrement audio non supporté par ce navigateur", "error");
    return;
  }

  try {
    mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true });
  } catch (err) {
    setStatut(els.generationStatut, "Accès au micro refusé", "error");
    return;
  }

  const mimeType = ["audio/webm", "audio/ogg", "audio/mp4"].find(
    (type) => window.MediaRecorder && MediaRecorder.isTypeSupported(type)
  );

  mediaRecorder = new MediaRecorder(mediaStream, mimeType ? { mimeType } : undefined);
  audioChunks = [];

  mediaRecorder.addEventListener("dataavailable", (event) => {
    if (event.data.size > 0) {
      audioChunks.push(event.data);
    }
  });

  mediaRecorder.addEventListener("stop", async () => {
    setMicState(false);
    mediaStream.getTracks().forEach((track) => track.stop());
    mediaStream = null;

    if (audioChunks.length === 0) {
      els.micStatut.textContent = "";
      return;
    }

    const blob = new Blob(audioChunks, { type: mediaRecorder.mimeType || "audio/webm" });
    audioChunks = [];
    await transcrireEtInjecter(blob);
  });

  mediaRecorder.start();
  setMicState(true);
  els.micStatut.textContent = "Enregistrement en cours…";
});

async function transcrireEtInjecter(blob) {
  els.micBtn.disabled = true;
  els.micStatut.textContent = "Préparation…";
  try {
    // La transcription tourne intégralement dans le navigateur : l'audio ne
    // part sur aucun serveur et n'est jamais écrit sur disque.
    const { transcrire } = await import("/transcription.js");
    const texte = await transcrire(blob, (etape) => {
      els.micStatut.textContent = etape;
    });

    const separateur = els.saisie.value.trim().length > 0 ? "\n\n" : "";
    els.saisie.value = els.saisie.value + separateur + texte;
    saisieDictee = true;
    els.micStatut.textContent = "Transcription ajoutée — relisez avant de générer.";
  } catch (err) {
    setStatut(els.generationStatut, `Échec de la transcription : ${err.message}`, "error");
    els.micStatut.textContent = "";
  } finally {
    els.micBtn.disabled = false;
  }
}

// --- Initialisation ---

loadEtablissements().catch((err) => setStatut(els.patientStatut, err.message, "error"));
loadPatients().catch((err) => setStatut(els.patientStatut, err.message, "error"));
loadUtilisateurs().catch((err) => setStatut(els.generationStatut, err.message, "error"));
