@echo off
REM ProjectGamma . update — git pull + server-restart in einem schritt.
REM Team-mitglieder bekommen das update automatisch beim naechsten F5
REM (sie laden alle JS/CSS/HTML vom server, kein eigener client-install noetig).
title ProjectGamma . update

setlocal
set ROOT=%~dp0
set SERVER=%ROOT%sync-server

echo ============================================
echo   ProjectGamma . update
echo ============================================
echo.

REM ============================================================
REM 1) GIT-CHECK (ohne git geht das update nicht)
REM ============================================================
where git >nul 2>nul
if errorlevel 1 (
  echo [FEHLER] git nicht installiert. Bitte erst installieren:
  echo   https://git-scm.com/download/win
  pause
  exit /b 1
)

REM ============================================================
REM 2) LAUFENDEN SERVER STOPPEN
REM    a^) per fenster-titel ^("ProjectGamma . server"^) — wenn start.bat
REM       das fenster gestartet hat, ist der titel garantiert.
REM    b^) fallback: alles auf port 7892 killen.
REM ============================================================
echo [1/4] stoppe laufenden server...
taskkill /F /FI "WINDOWTITLE eq ProjectGamma . server*" >nul 2>nul

REM Fallback: kill node-prozess auf port 7892
for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":7892" ^| findstr "LISTENING" 2^>nul') do (
  taskkill /F /PID %%a >nul 2>nul
)

REM Kurz warten bis port frei ist
timeout /t 2 /nobreak >nul

REM ============================================================
REM 3) GIT PULL
REM    --ff-only verhindert merge-commits bei lokalen aenderungen.
REM    Wenn der user lokal aenderungen hat: error -^> hilf-text.
REM ============================================================
echo [2/4] hole neueste version aus github...
pushd "%ROOT%"
git fetch origin main
if errorlevel 1 (
  echo [FEHLER] git fetch fehlgeschlagen. Internet pruefen.
  popd
  pause
  exit /b 1
)
git pull --ff-only origin main
if errorlevel 1 (
  echo.
  echo [WARN] git pull --ff-only fehlgeschlagen — du hast lokale aenderungen
  echo        ^(z.B. selbst was geaendert^) die mit dem update kollidieren.
  echo        Optionen:
  echo          1^) lokale aenderungen committen:  git commit -am "lokal"
  echo          2^) lokale aenderungen verwerfen:  git reset --hard origin/main
  echo          3^) update jetzt abbrechen.
  echo.
  popd
  pause
  exit /b 1
)
popd

REM ============================================================
REM 4) NPM-DEPS aktualisieren ^(falls package.json sich geaendert hat^)
REM ============================================================
echo [3/4] dependencies pruefen...
pushd "%SERVER%"
call npm install --omit=dev --silent
popd

REM ============================================================
REM 5) SERVER NEU STARTEN ^(ueber start.bat damit alle checks laufen^)
REM ============================================================
echo [4/4] server neu starten...
echo.
echo team-mitglieder muessen nur F5 druecken — neue UI wird automatisch
echo vom server geladen ^(kein eigener download noetig^).
echo.

REM start.bat in neuem prozess starten damit dieses fenster zu kann.
start "ProjectGamma . relaunch" cmd /c "%ROOT%start.bat"

echo ============================================
echo   update fertig.
echo ============================================
echo.
timeout /t 4 /nobreak >nul
exit /b 0
