import {
  Paragraph,
  HeadingLevel,
  Table,
  TableRow,
  TableCell,
  TextRun,
  WidthType,
} from "docx";
import type { BlocBilan, ModeleBilan } from "../schema/modelesBilan";

/**
 * Rendu .docx des bilans à trame fixe (Répit, Trimestriel).
 *
 * Le document est reconstitué en parcourant la trame décrite dans
 * `modelesBilan.ts`, jamais une liste de sections recopiée ici : une ligne
 * ajoutée à une grille apparaît donc dans l'export sans autre intervention, et
 * il est impossible qu'une section existe à l'écran mais pas dans le fichier.
 *
 * Une valeur absente est rendue par un tiret. C'est un marqueur d'absence
 * visible, pas un remplissage : le document transmis doit montrer ce qui n'a
 * pas été renseigné.
 */

const ABSENT = "—";

function cellule(texte: string, options: { gras?: boolean; largeur?: number } = {}) {
  return new TableCell({
    children: [
      new Paragraph({
        children: [new TextRun({ text: texte, bold: options.gras ?? false })],
      }),
    ],
    width: options.largeur
      ? { size: options.largeur, type: WidthType.PERCENTAGE }
      : undefined,
  });
}

function valeurTexte(valeur: unknown): string {
  if (typeof valeur === "string" && valeur.trim() !== "") {
    return valeur;
  }
  return ABSENT;
}

function rendreChamps(bloc: Extract<BlocBilan, { type: "champs" }>, valeurs: unknown) {
  const donnees = (valeurs ?? {}) as Record<string, unknown>;
  const elements: (Paragraph | Table)[] = [];

  if (bloc.titre) {
    elements.push(new Paragraph({ text: bloc.titre, heading: HeadingLevel.HEADING_2 }));
  }
  for (const champ of bloc.champs) {
    elements.push(
      new Paragraph({
        children: [
          new TextRun({ text: `${champ.libelle} : `, bold: true }),
          new TextRun(valeurTexte(donnees[champ.cle])),
        ],
      })
    );
  }
  return elements;
}

/**
 * Grille de cotation : une colonne par niveau d'échelle, une croix dans la
 * case retenue. C'est la forme du document d'origine, où l'on coche.
 */
function rendreTableau(
  bloc: Extract<BlocBilan, { type: "tableau" }>,
  modele: ModeleBilan,
  valeurs: unknown
) {
  const options = modele.echelles[bloc.echelle] ?? [];
  const donnees = (valeurs ?? {}) as Record<string, unknown>;
  const elements: (Paragraph | Table)[] = [];

  if (bloc.titre) {
    elements.push(new Paragraph({ text: bloc.titre, heading: HeadingLevel.HEADING_2 }));
  }

  const largeurCote = Math.floor(50 / Math.max(options.length, 1));
  const enTete = new TableRow({
    children: [
      cellule("", { gras: true, largeur: 50 }),
      ...options.map((option) => cellule(option, { gras: true, largeur: largeurCote })),
    ],
  });

  const lignes = bloc.lignes.map((ligne) => {
    const choisi = donnees[ligne.cle];
    return new TableRow({
      children: [
        cellule(ligne.libelle, { largeur: 50 }),
        ...options.map((option) =>
          cellule(choisi === option ? "X" : "", { largeur: largeurCote })
        ),
      ],
    });
  });

  elements.push(
    new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, rows: [enTete, ...lignes] })
  );
  return elements;
}

function rendreGrille(
  bloc: Extract<BlocBilan, { type: "grille" }>,
  valeurs: unknown
) {
  const donnees = (valeurs ?? {}) as Record<string, Record<string, unknown>>;
  const elements: (Paragraph | Table)[] = [];

  if (bloc.titre) {
    elements.push(new Paragraph({ text: bloc.titre, heading: HeadingLevel.HEADING_2 }));
  }

  const largeur = Math.floor(100 / (bloc.colonnes.length + 1));
  const enTete = new TableRow({
    children: [
      cellule(bloc.enTeteLignes, { gras: true, largeur }),
      ...bloc.colonnes.map((colonne) =>
        cellule(colonne.libelle, { gras: true, largeur })
      ),
    ],
  });

  const lignes = bloc.lignes.map((ligne) => {
    const cellules = donnees[ligne.cle] ?? {};
    return new TableRow({
      children: [
        cellule(ligne.libelle, { largeur }),
        ...bloc.colonnes.map((colonne) =>
          cellule(valeurTexte(cellules[colonne.cle]), { largeur })
        ),
      ],
    });
  });

  elements.push(
    new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, rows: [enTete, ...lignes] })
  );
  return elements;
}

function rendreRepetable(
  bloc: Extract<BlocBilan, { type: "repetable" }>,
  valeurs: unknown
) {
  const donnees = Array.isArray(valeurs) ? (valeurs as Record<string, unknown>[]) : [];
  const elements: (Paragraph | Table)[] = [];

  if (bloc.titre) {
    elements.push(new Paragraph({ text: bloc.titre, heading: HeadingLevel.HEADING_2 }));
  }

  // Une section vide se dit : l'absence de comportement problème relevé est
  // une information, la faire disparaître en serait une autre.
  if (donnees.length === 0) {
    elements.push(new Paragraph("Aucun élément renseigné."));
    return elements;
  }

  const largeur = Math.floor(100 / bloc.colonnes.length);
  const enTete = new TableRow({
    children: bloc.colonnes.map((colonne) =>
      cellule(colonne.libelle, { gras: true, largeur })
    ),
  });

  const lignes = donnees.map(
    (entree) =>
      new TableRow({
        children: bloc.colonnes.map((colonne) =>
          cellule(valeurTexte(entree[colonne.cle]), { largeur })
        ),
      })
  );

  elements.push(
    new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, rows: [enTete, ...lignes] })
  );
  return elements;
}

function rendreBloc(
  bloc: BlocBilan,
  modele: ModeleBilan,
  contenu: Record<string, unknown>
): (Paragraph | Table)[] {
  const valeurs = contenu[bloc.cle];

  switch (bloc.type) {
    case "champs":
      return rendreChamps(bloc, valeurs);

    case "tableau":
      return rendreTableau(bloc, modele, valeurs);

    case "texte":
      return [
        new Paragraph({ text: bloc.libelle, heading: HeadingLevel.HEADING_2 }),
        new Paragraph(valeurTexte(valeurs)),
      ];

    case "liste": {
      const entrees = Array.isArray(valeurs) ? (valeurs as unknown[]) : [];
      return [
        new Paragraph({ text: bloc.libelle, heading: HeadingLevel.HEADING_2 }),
        ...(entrees.length === 0
          ? [new Paragraph(ABSENT)]
          : entrees.map(
              (entree) =>
                new Paragraph({ text: valeurTexte(entree), bullet: { level: 0 } })
            )),
      ];
    }

    case "grille":
      return rendreGrille(bloc, valeurs);

    case "repetable":
      return rendreRepetable(bloc, valeurs);
  }
}

/** Corps du document, prêt à être inséré dans une section `docx`. */
export function elementsDepuisModele(
  modele: ModeleBilan,
  contenu: Record<string, unknown>
): (Paragraph | Table)[] {
  const elements: (Paragraph | Table)[] = [
    new Paragraph({ text: modele.nom, heading: HeadingLevel.TITLE }),
  ];

  for (const etape of modele.etapes) {
    elements.push(
      new Paragraph({ text: etape.titre, heading: HeadingLevel.HEADING_1 })
    );
    if (etape.intro) {
      elements.push(new Paragraph({ children: [new TextRun({ text: etape.intro, italics: true })] }));
    }
    for (const bloc of etape.blocs) {
      elements.push(...rendreBloc(bloc, modele, contenu));
    }
  }

  return elements;
}
