/**
 * Sauvegarde et restauration de la base.
 *
 *   node scripts/sauvegarde.mjs            → crée une sauvegarde horodatée
 *   node scripts/sauvegarde.mjs --lister   → liste les sauvegardes présentes
 *   node scripts/sauvegarde.mjs --restaurer <fichier>
 *
 * Pourquoi un script plutôt qu'une case à cocher chez l'hébergeur : une
 * sauvegarde qu'on n'a jamais restaurée n'est pas une sauvegarde. Celle-ci se
 * déclenche à la main ou par tâche planifiée, produit un fichier qu'on peut
 * emporter, et la restauration se teste sur une base jetable.
 *
 * Le fichier produit contient l'intégralité des données de santé de la
 * structure : il doit être chiffré au repos et conservé au même niveau
 * d'exigence que la base elle-même. Le dossier est ignoré par git.
 */
import "dotenv/config";
import { spawn } from "node:child_process";
import { mkdir, readdir, stat } from "node:fs/promises";
import path from "node:path";

const DOSSIER = process.env.SAUVEGARDE_DIR ?? "sauvegardes";

function urlBase() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("DATABASE_URL absente : renseignez-la dans .env.");
    process.exit(1);
  }
  return url;
}

function executer(commande, args) {
  return new Promise((resoudre, rejeter) => {
    const processus = spawn(commande, args, { stdio: "inherit" });
    processus.on("error", (err) =>
      rejeter(
        new Error(
          err.code === "ENOENT"
            ? `${commande} introuvable. Installez les outils clients PostgreSQL ` +
              `(postgresql-client sous Debian/Ubuntu, inclus dans l'installateur Windows).`
            : err.message
        )
      )
    );
    processus.on("close", (code) =>
      code === 0 ? resoudre() : rejeter(new Error(`${commande} a terminé avec le code ${code}`))
    );
  });
}

function horodatage() {
  const maintenant = new Date();
  const p = (n) => String(n).padStart(2, "0");
  return (
    `${maintenant.getFullYear()}${p(maintenant.getMonth() + 1)}${p(maintenant.getDate())}` +
    `-${p(maintenant.getHours())}${p(maintenant.getMinutes())}`
  );
}

async function sauvegarder() {
  await mkdir(DOSSIER, { recursive: true });
  const fichier = path.join(DOSSIER, `outils-educsp-${horodatage()}.dump`);

  console.log(`Sauvegarde vers ${fichier}…`);
  // Format personnalisé (-Fc) : compressé, et restaurable table par table.
  await executer("pg_dump", ["--format=custom", "--file", fichier, urlBase()]);

  const infos = await stat(fichier);
  console.log(
    `Terminé : ${(infos.size / 1024 / 1024).toFixed(1)} Mo.\n` +
      "Ce fichier contient des données de santé : chiffrez-le et rangez-le " +
      "hors du serveur."
  );
}

async function lister() {
  let fichiers;
  try {
    fichiers = await readdir(DOSSIER);
  } catch {
    console.log(`Aucune sauvegarde : le dossier ${DOSSIER} n'existe pas encore.`);
    return;
  }

  const dumps = fichiers.filter((nom) => nom.endsWith(".dump")).sort().reverse();
  if (dumps.length === 0) {
    console.log("Aucune sauvegarde.");
    return;
  }

  for (const nom of dumps) {
    const infos = await stat(path.join(DOSSIER, nom));
    console.log(
      `${nom}  ${(infos.size / 1024 / 1024).toFixed(1)} Mo  ` +
        infos.mtime.toLocaleString("fr-FR")
    );
  }
}

async function restaurer(fichier) {
  if (!fichier) {
    console.error("Indiquez le fichier : node scripts/sauvegarde.mjs --restaurer <fichier>");
    process.exit(1);
  }

  // Garde-fou : la restauration écrase des données. On exige que la cible soit
  // déclarée explicitement, pour ne pas écraser la production sur une erreur
  // de terminal.
  if (!process.env.RESTAURER_VERS) {
    console.error(
      "Restauration refusée : définissez RESTAURER_VERS avec l'URL de la base cible.\n" +
        "Exemple : RESTAURER_VERS=postgres://…/base_de_test node scripts/sauvegarde.mjs --restaurer " +
        fichier +
        "\n\nC'est volontaire : une restauration écrase des données, elle ne doit " +
        "pas pouvoir partir sur la base courante par inadvertance."
    );
    process.exit(1);
  }

  console.log(`Restauration de ${fichier} vers la base indiquée par RESTAURER_VERS…`);
  await executer("pg_restore", [
    "--clean",
    "--if-exists",
    "--no-owner",
    "--dbname",
    process.env.RESTAURER_VERS,
    fichier,
  ]);
  console.log("Restauration terminée.");
}

const args = process.argv.slice(2);
const action = args.includes("--lister")
  ? lister()
  : args.includes("--restaurer")
    ? restaurer(args[args.indexOf("--restaurer") + 1])
    : sauvegarder();

action.catch((err) => {
  console.error(`\n${err.message}\n`);
  process.exit(1);
});
