import {
  Document,
  Packer,
  Paragraph,
  HeadingLevel,
  Table,
  TableRow,
  TableCell,
  TextRun,
  WidthType,
} from "docx";
import type { Bilan } from "../schema/bilan.schema";
import { MODELES, type TypeBilan } from "../schema/modelesBilan";
import { elementsDepuisModele } from "./modeleDocxExport";
import type { Etablissement } from "../repositories/etablissementRepository";

/**
 * En-tête de la structure émettrice.
 *
 * Un bilan est transmis à une famille, à une MDPH, à un partenaire : il doit
 * porter l'identité de l'établissement qui l'émet, sinon le fichier produit
 * n'est pas utilisable tel quel et se retrouve recopié à la main dans un autre
 * document. Les coordonnées absentes ne laissent pas de ligne vide.
 */
function enTeteEtablissement(etablissement?: Etablissement | null): Paragraph[] {
  if (!etablissement) {
    return [];
  }

  const coordonnees = [
    etablissement.adresse,
    etablissement.telephone,
    etablissement.email,
  ]
    .map((valeur) => valeur.trim())
    .filter(Boolean)
    .join(" · ");

  return [
    new Paragraph({
      children: [new TextRun({ text: etablissement.nom, bold: true, size: 26 })],
    }),
    ...(coordonnees
      ? [
          new Paragraph({
            children: [new TextRun({ text: coordonnees, size: 18, color: "555555" })],
          }),
        ]
      : []),
    new Paragraph({ text: "" }),
  ];
}

/**
 * Module unique de conversion JSON → .docx (BRIEF_PROJET §7) : aucune
 * autre partie du code ne doit générer de .docx. La mise en forme est
 * strictement déterministe — aucun recalcul, aucune donnée ajoutée par
 * rapport au JSON validé (§4).
 */

function headerCell(text: string): TableCell {
  return new TableCell({
    children: [new Paragraph({ children: [new TextRun({ text, bold: true })] })],
    width: { size: 33, type: WidthType.PERCENTAGE },
  });
}

function bodyCell(text: string): TableCell {
  return new TableCell({
    children: [new Paragraph(text || "—")],
    width: { size: 33, type: WidthType.PERCENTAGE },
  });
}

function buildEnTeteParagraphs(bilan: Bilan): Paragraph[] {
  const enTete = bilan.en_tete;
  const lignes: [string, string][] = [
    ["Structure", enTete.structure],
    ["Période", `${enTete.periode_debut} → ${enTete.periode_fin}`],
    [
      "Bénéficiaire",
      `${enTete.beneficiaire_nom} (${enTete.beneficiaire_age} ans)`,
    ],
    ["Date de naissance", enTete.beneficiaire_date_naissance ?? ""],
    ["Lieu de naissance", enTete.beneficiaire_lieu_naissance ?? ""],
    [
      "Professionnels intervenants",
      enTete.professionnels_intervenants.join(", "),
    ],
    ["Jours / horaires d'intervention", enTete.jours_heures_intervention],
    ["Lieux", enTete.lieux],
    ["Personnes présentes", enTete.personnes_presentes],
    ["Date de début d'intervention", enTete.date_debut_intervention],
  ];

  return [
    new Paragraph({
      text: "Bilan éducatif trimestriel",
      heading: HeadingLevel.TITLE,
    }),
    ...lignes.map(
      ([label, value]) =>
        new Paragraph({
          children: [
            new TextRun({ text: `${label} : `, bold: true }),
            new TextRun(value || "—"),
          ],
        })
    ),
  ];
}

function buildObjectifsTable(bilan: Bilan): (Paragraph | Table)[] {
  const rows = bilan.objectifs_intervention_periode.map(
    (o) =>
      new TableRow({
        children: [bodyCell(o.domaine_competence), bodyCell(o.objectif)],
      })
  );

  return [
    new Paragraph({
      text: "Objectifs d'intervention de la période",
      heading: HeadingLevel.HEADING_1,
    }),
    new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      rows: [
        new TableRow({
          children: [headerCell("Domaine de compétence"), headerCell("Objectif")],
        }),
        ...rows,
      ],
    }),
  ];
}

function buildEvaluationComportementTable(bilan: Bilan): (Paragraph | Table)[] {
  const rows = bilan.evaluation_comportement.map(
    (c) =>
      new TableRow({
        children: [bodyCell(c.type_comportement), bodyCell(c.frequence)],
      })
  );

  return [
    new Paragraph({
      text: "Évaluation des comportements",
      heading: HeadingLevel.HEADING_1,
    }),
    new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      rows: [
        new TableRow({
          children: [headerCell("Type de comportement"), headerCell("Fréquence")],
        }),
        ...rows,
      ],
    }),
  ];
}

function buildDonneesComplementaires(bilan: Bilan): Paragraph[] {
  if (!bilan.donnees_complementaires) {
    return [];
  }
  return [
    new Paragraph({
      text: "Données complémentaires",
      heading: HeadingLevel.HEADING_1,
    }),
    new Paragraph(bilan.donnees_complementaires),
  ];
}

function buildEvaluationParDomaine(bilan: Bilan): Paragraph[] {
  const paragraphs = [
    new Paragraph({
      text: "Évaluation des objectifs par domaine",
      heading: HeadingLevel.HEADING_1,
    }),
  ];
  for (const item of bilan.evaluation_objectifs_par_domaine) {
    paragraphs.push(
      new Paragraph({
        text: item.domaine_competence,
        heading: HeadingLevel.HEADING_2,
      })
    );
    paragraphs.push(new Paragraph(item.observations || "—"));
  }
  return paragraphs;
}

function buildAutresObservations(bilan: Bilan): Paragraph[] {
  if (bilan.autres_observations.length === 0) {
    return [];
  }
  return [
    new Paragraph({ text: "Autres observations", heading: HeadingLevel.HEADING_1 }),
    ...bilan.autres_observations.map((texte) => new Paragraph(texte)),
  ];
}

function buildPropositionTable(bilan: Bilan): (Paragraph | Table)[] {
  const rows = bilan.proposition_objectifs_periode_suivante.map(
    (p) =>
      new TableRow({
        children: [
          bodyCell(p.domaine_competence),
          bodyCell(p.objectif),
          bodyCell(p.comment),
        ],
      })
  );

  return [
    new Paragraph({
      text: "Proposition d'objectifs — période suivante",
      heading: HeadingLevel.HEADING_1,
    }),
    new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      rows: [
        new TableRow({
          children: [
            headerCell("Domaine de compétence"),
            headerCell("Objectif"),
            headerCell("Moyens / méthode"),
          ],
        }),
        ...rows,
      ],
    }),
  ];
}

/**
 * Produit le .docx correspondant à la trame du bilan.
 *
 * Aiguillage exhaustif : ajouter une trame sans son rendu devient une erreur
 * de compilation, plutôt qu'un export silencieusement vide.
 */
export async function genererBilanDocx(
  type: TypeBilan,
  contenu: unknown,
  etablissement?: Etablissement | null
): Promise<Buffer> {
  let children;

  switch (type) {
    case "bilan": {
      const bilan = contenu as Bilan;
      children = [
        ...buildEnTeteParagraphs(bilan),
        ...buildObjectifsTable(bilan),
        ...buildEvaluationComportementTable(bilan),
        ...buildDonneesComplementaires(bilan),
        ...buildEvaluationParDomaine(bilan),
        ...buildAutresObservations(bilan),
        ...buildPropositionTable(bilan),
      ];
      break;
    }
    case "repit":
    case "trimestriel":
      children = elementsDepuisModele(
        MODELES[type],
        contenu as Record<string, unknown>
      );
      break;
    default: {
      const jamais: never = type;
      throw new Error(`Export non géré pour le type de bilan : ${jamais}`);
    }
  }

  return Packer.toBuffer(
    new Document({
      sections: [{ children: [...enTeteEtablissement(etablissement), ...children] }],
    })
  );
}

const COMBINING_DIACRITICS = new RegExp("[̀-ͯ]", "g");

/** Enlève les diacritiques et caractères non sûrs pour un nom de fichier. */
function slugifierPourNomFichier(texte: string): string {
  return texte
    .normalize("NFD")
    .replace(COMBINING_DIACRITICS, "")
    .replace(/[^a-zA-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

const PREFIXE_FICHIER: Record<TypeBilan, string> = {
  bilan: "Bilan",
  repit: "Bilan_repit",
  trimestriel: "Bilan_trimestriel",
};

/** Nommage imposé (§7) : <trame>_<nom_patient>_<periode>.docx */
export function nomFichierBilanDocx(
  type: TypeBilan,
  nomPatientComplet: string,
  periodeDebut: string,
  periodeFin: string
): string {
  const nom = slugifierPourNomFichier(nomPatientComplet);
  const periode = `${slugifierPourNomFichier(periodeDebut)}_${slugifierPourNomFichier(periodeFin)}`;
  return `${PREFIXE_FICHIER[type]}_${nom}_${periode}.docx`;
}
