import { describe, it, expect } from "vitest";

/**
 * Le masquage est le seul rempart entre un compte-rendu et un fournisseur
 * situé hors de l'Union. Ce qu'on vérifie ici n'est donc pas qu'il « marche »,
 * mais deux choses précises :
 *
 *  - qu'aucun nom **connu de la base** ne survit à la préparation, quelle que
 *    soit la façon dont l'éducateur l'a écrit ;
 *  - que ce qu'il **ne couvre pas** est énoncé par un test plutôt que caché.
 *    Un test qui n'existe pas laisse croire à une garantie qui n'est pas là.
 *
 * Tous les noms de ce fichier sont inventés : aucune donnée réelle dans le
 * dépôt, même en fixture.
 */
const masquage = () => import("../public/js/local/masquage.js" as string);

const DOSSIER = {
  beneficiaire: { prenom: "Amélie", nom: "Rousseau-Lambert" },
  autres: [{ prenom: "Théo", nom: "Vasseur" }],
  auteur: { prenom: "Camille", nom: "Durand" },
  activite: "Accueil de la Fontaine",
};

describe("préparation d'un compte-rendu", () => {
  it("retire le bénéficiaire, l'entourage du dossier, l'auteur et l'activité", async () => {
    const { preparerEnvoi } = await masquage();
    const { texte } = preparerEnvoi(
      "Amélie Rousseau-Lambert a joué avec Théo Vasseur. " +
        "Camille Durand a encadré la séance à l'Accueil de la Fontaine.",
      DOSSIER
    );

    for (const nom of [
      "Amélie",
      "Rousseau",
      "Lambert",
      "Théo",
      "Vasseur",
      "Camille",
      "Durand",
      "Fontaine",
    ]) {
      expect(texte, `« ${nom} » ne doit pas sortir`).not.toContain(nom);
    }
    expect(texte).toContain("[B1]");
    expect(texte).toContain("[B2]");
    expect(texte).toContain("[E1]");
    expect(texte).toContain("[A1]");
  });

  it("attrape le nom quelle que soit sa graphie", async () => {
    const { preparerEnvoi } = await masquage();
    // Un éducateur écrit vite : accents omis, casse variable, nom composé
    // tantôt lié tantôt espacé, nom de famille seul, ordre inversé.
    const { texte } = preparerEnvoi(
      "amelie est arrivée. AMÉLIE a mangé. Rousseau Lambert a dormi. " +
        "rousseau-lambert amelie était calme. Mme Rousseau-Lambert est passée.",
      DOSSIER
    );
    expect(texte.toLowerCase()).not.toContain("amelie");
    expect(texte.toLowerCase()).not.toContain("amélie");
    expect(texte.toLowerCase()).not.toContain("rousseau");
    expect(texte.toLowerCase()).not.toContain("lambert");
  });

  it("ne mord pas à l'intérieur d'un autre mot", async () => {
    const { preparerEnvoi } = await masquage();
    // « Théo » ne doit pas découper « théorie », ni « Léa » couper « pléiade ».
    const { texte } = preparerEnvoi(
      "En théorie, la séance s'est bien passée. Théo est reparti.",
      DOSSIER
    );
    expect(texte).toContain("théorie");
    expect(texte).toContain("[B2] est reparti");
  });

  it("remplace le nom complet avant ses morceaux", async () => {
    const { preparerEnvoi } = await masquage();
    // Sans l'ordre du plus long au plus court, « Amélie Rousseau-Lambert »
    // laisserait « [B1] [B1] » ou « [B1]-Lambert » derrière lui.
    const { texte } = preparerEnvoi("Amélie Rousseau-Lambert a progressé.", DOSSIER);
    expect(texte).toBe("[B1] a progressé.");
  });

  it("laisse le texte intact quand la base ne connaît personne", async () => {
    const { preparerEnvoi } = await masquage();
    const original = "La séance s'est bien passée.";
    expect(preparerEnvoi(original, {}).texte).toBe(original);
  });
});

describe("restitution de la réponse", () => {
  it("remet les noms partout dans le document, pas seulement en surface", async () => {
    const { preparerEnvoi, restituer } = await masquage();
    const { table } = preparerEnvoi("Amélie", DOSSIER);

    const rendu = restituer(
      {
        en_tete: { beneficiaire_nom: "[B1]", structure: "[A1]" },
        sections: [{ observations: "[B1] a joué avec [B2]." }],
        listes: [["[E1] était présente"]],
      },
      table
    );

    expect(rendu.en_tete.beneficiaire_nom).toBe("Amélie Rousseau-Lambert");
    expect(rendu.en_tete.structure).toBe("Accueil de la Fontaine");
    expect(rendu.sections[0].observations).toBe(
      "Amélie Rousseau-Lambert a joué avec Théo Vasseur."
    );
    expect(rendu.listes[0][0]).toBe("Camille Durand était présente");
  });

  it("fait l'aller-retour sans rien perdre", async () => {
    const { preparerEnvoi, restituer } = await masquage();
    const original =
      "Amélie Rousseau-Lambert a joué avec Théo Vasseur, encadrée par Camille Durand.";
    const { texte, table } = preparerEnvoi(original, DOSSIER);
    expect(restituer(texte, table)).toBe(original);
  });
});

describe("ce que le masquage ne couvre pas", () => {
  it("laisse passer un nom que la base ne connaît pas", async () => {
    const { preparerEnvoi } = await masquage();
    // C'est la limite du procédé, et elle est délibérée : reconnaître un nom
    // par sa forme reviendrait à deviner, et à donner une assurance fausse.
    // C'est à cela que sert l'aperçu montré avant le premier envoi.
    const { texte } = preparerEnvoi(
      "Son frère Nolan est venu la chercher à l'école Jean-Moulin.",
      DOSSIER
    );
    expect(texte).toContain("Nolan");
    expect(texte).toContain("Jean-Moulin");
  });

  it("masque un nom court entier, mais pas comme fragment d'un nom composé", async () => {
    const { preparerEnvoi } = await masquage();

    // Un nom court pris en entier reste sûr : les bornes de mot l'empêchent de
    // mordre ailleurs. « Bo » ne découpe pas « Bonjour ».
    const seul = preparerEnvoi("Bo a participé. Bonjour à tous.", {
      beneficiaire: { prenom: "Bo", nom: "" },
    });
    expect(seul.texte).toBe("[B1] a participé. Bonjour à tous.");

    // En revanche, un morceau de moins de trois lettres n'est pas cherché
    // isolément : « Li » seul passerait, là où « Li Wang » et « Wang » sont
    // pris. Chercher deux lettres partout hacherait le compte-rendu au point de
    // le rendre illisible au modèle.
    const compose = preparerEnvoi("Li est arrivé avec Wang.", {
      beneficiaire: { prenom: "Li", nom: "Wang" },
    });
    expect(compose.texte).toContain("Li est arrivé");
    expect(compose.texte).toContain("[B1].");
  });
});

describe("aperçu", () => {
  it("énumère les jetons réellement posés", async () => {
    const { preparerEnvoi, jetonsPoses } = await masquage();
    const { texte, table } = preparerEnvoi("Amélie a vu Camille Durand.", DOSSIER);
    // Ce que l'aperçu peut affirmer : ceci a été retiré. Il n'affirme rien sur
    // ce qui resterait.
    expect(jetonsPoses(texte, table).sort()).toEqual(["[B1]", "[E1]"]);
  });
});
