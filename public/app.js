const patientSelect = document.getElementById("patient-select");
const auteurSelect = document.getElementById("auteur-select");
const statutEl = document.getElementById("statut");
const genererBtn = document.getElementById("generer");
const resultatSection = document.getElementById("resultat-section");
const resultatEl = document.getElementById("resultat");
const resultatJsonEl = document.getElementById("resultat-json");

function setStatut(message, kind) {
  statutEl.textContent = message ?? "";
  statutEl.className = "statut" + (kind ? " " + kind : "");
}

async function fetchJson(url, options) {
  const response = await fetch(url, options);
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    const detail = data && data.error ? data.error : `Erreur ${response.status}`;
    throw new Error(detail);
  }
  return data;
}

function fillSelect(select, items, labelFn) {
  select.innerHTML = "";
  if (items.length === 0) {
    const opt = document.createElement("option");
    opt.textContent = "(aucun — ajoutez-en un ci-dessous)";
    opt.value = "";
    select.appendChild(opt);
    return;
  }
  for (const item of items) {
    const opt = document.createElement("option");
    opt.value = item.id;
    opt.textContent = labelFn(item);
    select.appendChild(opt);
  }
}

async function loadPatients(selectId) {
  const patients = await fetchJson("/api/patients");
  fillSelect(patientSelect, patients, (p) => `${p.prenom} ${p.nom}`);
  if (selectId) {
    patientSelect.value = selectId;
  }
}

async function loadUtilisateurs(selectId) {
  const utilisateurs = await fetchJson("/api/utilisateurs");
  fillSelect(auteurSelect, utilisateurs, (u) => `${u.prenom} ${u.nom} (${u.email})`);
  if (selectId) {
    auteurSelect.value = selectId;
  }
}

document.getElementById("patient-refresh").addEventListener("click", () => {
  loadPatients().catch((err) => setStatut(err.message, "error"));
});

document.getElementById("auteur-refresh").addEventListener("click", () => {
  loadUtilisateurs().catch((err) => setStatut(err.message, "error"));
});

document.getElementById("patient-create").addEventListener("click", async () => {
  const nom = document.getElementById("patient-nom").value.trim();
  const prenom = document.getElementById("patient-prenom").value.trim();
  if (!nom || !prenom) {
    setStatut("Nom et prénom du bénéficiaire requis", "error");
    return;
  }
  try {
    const created = await fetchJson("/api/patients", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ nom, prenom }),
    });
    await loadPatients(created.id);
    document.getElementById("patient-nom").value = "";
    document.getElementById("patient-prenom").value = "";
    setStatut("Bénéficiaire ajouté", "ok");
  } catch (err) {
    setStatut(err.message, "error");
  }
});

document.getElementById("auteur-create").addEventListener("click", async () => {
  const nom = document.getElementById("auteur-nom").value.trim();
  const prenom = document.getElementById("auteur-prenom").value.trim();
  const email = document.getElementById("auteur-email").value.trim();
  if (!nom || !prenom || !email) {
    setStatut("Nom, prénom et email de l'éducateur requis", "error");
    return;
  }
  try {
    const created = await fetchJson("/api/utilisateurs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ nom, prenom, email }),
    });
    await loadUtilisateurs(created.id);
    document.getElementById("auteur-nom").value = "";
    document.getElementById("auteur-prenom").value = "";
    document.getElementById("auteur-email").value = "";
    setStatut("Éducateur ajouté", "ok");
  } catch (err) {
    setStatut(err.message, "error");
  }
});

function el(tag, text) {
  const node = document.createElement(tag);
  if (text !== undefined) {
    node.textContent = text;
  }
  return node;
}

function renderListeDomaine(list, itemsFn) {
  const ul = el("ul");
  for (const item of list) {
    ul.appendChild(el("li", itemsFn(item)));
  }
  return ul;
}

function renderBilan(contenu) {
  resultatEl.innerHTML = "";

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
  resultatEl.appendChild(dl);

  resultatEl.appendChild(el("h3", "Objectifs de la période"));
  resultatEl.appendChild(
    renderListeDomaine(
      contenu.objectifs_intervention_periode,
      (o) => `${o.domaine_competence} — ${o.objectif}`
    )
  );

  resultatEl.appendChild(el("h3", "Évaluation des comportements"));
  resultatEl.appendChild(
    renderListeDomaine(
      contenu.evaluation_comportement,
      (c) => `${c.type_comportement} — ${c.frequence}`
    )
  );

  resultatEl.appendChild(el("h3", "Évaluation des objectifs par domaine"));
  resultatEl.appendChild(
    renderListeDomaine(
      contenu.evaluation_objectifs_par_domaine,
      (o) => `${o.domaine_competence} — ${o.observations}`
    )
  );

  if (contenu.autres_observations && contenu.autres_observations.length > 0) {
    resultatEl.appendChild(el("h3", "Autres observations"));
    resultatEl.appendChild(renderListeDomaine(contenu.autres_observations, (o) => o));
  }

  resultatEl.appendChild(el("h3", "Objectifs proposés — période suivante"));
  resultatEl.appendChild(
    renderListeDomaine(
      contenu.proposition_objectifs_periode_suivante,
      (o) => `${o.domaine_competence} — ${o.objectif} (${o.comment})`
    )
  );

  resultatJsonEl.textContent = JSON.stringify(contenu, null, 2);
  resultatSection.hidden = false;
  resultatSection.scrollIntoView({ behavior: "smooth", block: "start" });
}

genererBtn.addEventListener("click", async () => {
  const patientId = patientSelect.value;
  const auteurId = auteurSelect.value;
  const texte = document.getElementById("texte").value.trim();
  const periodeDebut = document.getElementById("periode-debut").value;
  const periodeFin = document.getElementById("periode-fin").value;

  if (!patientId) {
    setStatut("Sélectionnez ou ajoutez un bénéficiaire", "error");
    return;
  }
  if (!auteurId) {
    setStatut("Sélectionnez ou ajoutez un éducateur", "error");
    return;
  }
  if (!texte) {
    setStatut("Le compte-rendu ne peut pas être vide", "error");
    return;
  }
  if (!periodeDebut || !periodeFin) {
    setStatut("Renseignez la période (début et fin)", "error");
    return;
  }

  genererBtn.disabled = true;
  resultatSection.hidden = true;
  setStatut("Génération en cours… (peut prendre quelques secondes)", "");

  try {
    const result = await fetchJson(`/api/patients/${patientId}/bilans/generate`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-user-id": auteurId,
      },
      body: JSON.stringify({
        texte,
        periode_debut: periodeDebut,
        periode_fin: periodeFin,
      }),
    });
    setStatut(`Bilan généré (statut: ${result.statut}, id: ${result.id})`, "ok");
    renderBilan(result.contenu);
  } catch (err) {
    setStatut(err.message, "error");
  } finally {
    genererBtn.disabled = false;
  }
});

loadPatients().catch((err) => setStatut(err.message, "error"));
loadUtilisateurs().catch((err) => setStatut(err.message, "error"));
