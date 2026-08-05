<#
    Démarrage complet de l'application en un clic.

    Enchaîne : vérification de Node → création du fichier .env si absent
    (mot de passe et clé API demandés à la saisie) → installation des
    dépendances → migrations → serveur → ouverture du navigateur.

    Le script est réexécutable sans risque : il ne redemande rien et ne
    réinstalle rien s'il n'y a pas lieu.
#>

$ErrorActionPreference = "Stop"

# On se place à la racine du projet, quel que soit l'endroit d'où le script
# est lancé (le dossier de ce fichier est scripts\).
$racine = Split-Path -Parent $PSScriptRoot
Set-Location $racine

function Titre($texte) {
    Write-Host ""
    Write-Host "== $texte" -ForegroundColor DarkCyan
}

function Echec($texte) {
    Write-Host ""
    Write-Host $texte -ForegroundColor Red
    exit 1
}

Write-Host ""
Write-Host "  Bilans éducatifs - démarrage" -ForegroundColor White
Write-Host "  $racine" -ForegroundColor DarkGray

# --- 1. Node.js -------------------------------------------------------------

Titre "Vérification de Node.js"
try {
    $versionNode = (& node --version) 2>$null
} catch {
    $versionNode = $null
}
if (-not $versionNode) {
    Echec @"
Node.js n'est pas installé (ou pas dans le PATH).
Installez la version LTS depuis https://nodejs.org puis relancez ce fichier.
"@
}
Write-Host "Node $versionNode" -ForegroundColor Green

# --- 2. Fichier .env --------------------------------------------------------

Titre "Configuration"

if (Test-Path ".env") {
    Write-Host ".env déjà présent, conservé tel quel." -ForegroundColor Green
    Write-Host "(supprimez-le et relancez si vous voulez le ressaisir)" -ForegroundColor DarkGray
}
else {
    Write-Host "Premier démarrage : deux informations sont nécessaires."
    Write-Host ""

    Write-Host "1/2 - Mot de passe de l'utilisateur PostgreSQL 'postgres'." -ForegroundColor White
    Write-Host "      La saisie s'affiche en astérisques : tapez puis Entrée." -ForegroundColor DarkGray
    $motDePasseSecurise = Read-Host "      Mot de passe" -AsSecureString
    $motDePasse = [Runtime.InteropServices.Marshal]::PtrToStringAuto(
        [Runtime.InteropServices.Marshal]::SecureStringToBSTR($motDePasseSecurise))
    if ([string]::IsNullOrWhiteSpace($motDePasse)) {
        Echec "Aucun mot de passe saisi, arrêt."
    }

    Write-Host ""
    Write-Host "2/2 - Clé API Cerebras (gratuite sur cloud.cerebras.ai)." -ForegroundColor White
    $cleApi = Read-Host "      Clé API"
    if ([string]::IsNullOrWhiteSpace($cleApi)) {
        Echec "Aucune clé API saisie, arrêt. Le serveur refuse de démarrer sans elle."
    }

    # Le mot de passe est encodé pour l'URL : sans cela, un caractère comme
    # @ ou / casse l'analyse de DATABASE_URL et produit une erreur
    # « Invalid URL » très peu parlante.
    $motDePasseEncode = [uri]::EscapeDataString($motDePasse)

    $contenu = @"
DATABASE_URL=postgres://postgres:$motDePasseEncode@localhost:5432/outils_educsp
LLM_PROVIDER=cerebras
CEREBRAS_API_KEY=$($cleApi.Trim())
CEREBRAS_MODEL=gpt-oss-120b
CEREBRAS_BASE_URL=https://api.cerebras.ai/v1
PORT=3000
"@

    # WriteAllText écrit en UTF-8 sans BOM. Set-Content ajouterait un BOM que
    # le lecteur de .env interpréterait comme faisant partie du premier nom
    # de variable.
    [System.IO.File]::WriteAllText((Join-Path $racine ".env"), $contenu)
    Write-Host ""
    Write-Host ".env créé." -ForegroundColor Green
}

# --- 3. Dépendances ---------------------------------------------------------

Titre "Dépendances"
if (Test-Path "node_modules") {
    Write-Host "Déjà installées." -ForegroundColor Green
}
else {
    Write-Host "Installation (une à deux minutes la première fois)…"
    & npm install
    if ($LASTEXITCODE -ne 0) { Echec "npm install a échoué." }
}

# --- 4. Base de données -----------------------------------------------------

Titre "Base de données"
& npm run migrate
if ($LASTEXITCODE -ne 0) {
    Echec @"
Les migrations ont échoué. Causes les plus fréquentes :

  - PostgreSQL n'est pas démarré
    Services Windows > 'postgresql-x64-18' > Démarrer

  - La base 'outils_educsp' n'existe pas encore. Créez-la :
    & "C:\Program Files\PostgreSQL\18\bin\createdb.exe" -U postgres outils_educsp

  - Le mot de passe enregistré est faux
    Supprimez le fichier .env puis relancez ce script pour le ressaisir.
"@
}

# --- 5. Serveur -------------------------------------------------------------

Titre "Démarrage du serveur"

$port = 3000
$occupe = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue
if ($occupe) {
    $pidOccupant = $occupe[0].OwningProcess
    Write-Host "Le port $port est déjà utilisé par le processus $pidOccupant." -ForegroundColor Yellow
    $reponse = Read-Host "Arrêter ce processus et continuer ? (O/n)"
    if ($reponse -eq "" -or $reponse -match "^[oOyY]") {
        Stop-Process -Id $pidOccupant -Force
        Start-Sleep -Seconds 1
        Write-Host "Processus arrêté." -ForegroundColor Green
    }
    else {
        Echec "Port occupé, arrêt."
    }
}

# Le serveur tourne dans cette fenêtre : la fermer arrête l'application.
# On ouvre le navigateur en parallèle, une fois le port réellement à l'écoute.
$ouvreNavigateur = {
    param($url)
    for ($i = 0; $i -lt 40; $i++) {
        Start-Sleep -Milliseconds 500
        try {
            Invoke-WebRequest -Uri "$url/health" -UseBasicParsing -TimeoutSec 2 | Out-Null
            Start-Process $url
            return
        } catch { }
    }
}
Start-Job -ScriptBlock $ouvreNavigateur -ArgumentList "http://localhost:$port" | Out-Null

Write-Host ""
Write-Host "  L'application va s'ouvrir dans votre navigateur." -ForegroundColor Green
Write-Host "  http://localhost:$port" -ForegroundColor White
Write-Host ""
Write-Host "  Gardez cette fenêtre ouverte pendant l'utilisation." -ForegroundColor DarkGray
Write-Host "  Fermez-la, ou faites Ctrl+C, pour arrêter l'application." -ForegroundColor DarkGray
Write-Host ""

& npm run dev
