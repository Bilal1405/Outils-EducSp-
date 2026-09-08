@echo off
REM Lanceur en un clic (Windows). Double-cliquez sur ce fichier.
REM
REM Toute la logique est dans scripts/lancer.ps1 ; ce fichier ne sert qu'a
REM l'appeler en contournant la politique d'execution PowerShell, qui bloque
REM les scripts .ps1 par defaut sur un poste Windows standard.
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "scripts\lancer.ps1"
if errorlevel 1 (
  echo.
  echo Le demarrage a echoue. Lisez le message ci-dessus.
  pause
)
