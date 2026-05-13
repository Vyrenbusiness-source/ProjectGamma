@echo off
REM ProjectGamma . One-Click-Start mit Auto-Setup
REM Doppelklick startet alles: deps pruefen + auto-installieren -> server -> browser
REM Voraussetzung: Node.js (alles andere wird automatisch installiert oder optional)
title ProjectGamma . launcher

setlocal
set ROOT=%~dp0
set SERVER=%ROOT%sync-server
set ADB=%LOCALAPPDATA%\Android\Sdk\platform-tools\adb.exe

echo ============================================
echo   ProjectGamma . launcher
echo ============================================
echo.

REM ============================================================
REM 1) NODE.JS-CHECK (manuelle installation noetig, kein admin)
REM ============================================================
where node >nul 2>nul
if errorlevel 1 (
  echo [FEHLT] node.js ist nicht installiert.
  echo.
  echo Bitte installieren von:
  echo   https://nodejs.org/de/download
  echo.
  echo Nach der installation einfach diese .bat erneut doppelklicken.
  echo.
  pause
  exit /b 1
)
for /f "tokens=*" %%v in ('node --version') do set NODE_VER=%%v
echo [ok] node.js %NODE_VER%

REM ============================================================
REM 2) NPM-DEPS (sync-server)
REM ============================================================
if not exist "%SERVER%\node_modules" (
  echo [setup] erste installation - sync-server abhaengigkeiten...
  echo         das dauert ca. 30-60 sekunden, nur beim ersten start.
  echo.
  pushd "%SERVER%"
  call npm install --omit=dev --silent
  if errorlevel 1 (
    echo.
    echo [FEHLER] npm install fehlgeschlagen.
    echo Pruefe deine internet-verbindung und versuche es nochmal.
    pause
    popd
    exit /b 1
  )
  popd
  echo [ok] sync-server abhaengigkeiten installiert.
) else (
  echo [ok] sync-server abhaengigkeiten vorhanden.
)

REM ============================================================
REM 3) CLAUDE CLI-CHECK + AUTO-INSTALL (kritisch fuer cc-feature)
REM ============================================================
where claude >nul 2>nul
if errorlevel 1 (
  echo.
  echo [setup] claude CLI nicht gefunden - installiere global via npm...
  echo.
  call npm install -g @anthropic-ai/claude-code --silent
  if errorlevel 1 (
    echo [WARN] claude-cli installation fehlgeschlagen.
    echo        cc-features sind ohne claude-cli nicht nutzbar.
    echo        Manuell: npm install -g @anthropic-ai/claude-code
    echo        Dann: claude auth login
    timeout /t 4 /nobreak >nul
  ) else (
    echo [ok] claude CLI installiert.
    echo.
    echo [hinweis] vor erster nutzung einmal: claude auth login
    echo           ^(oeffnet browser fuer anthropic-account^)
    echo.
  )
) else (
  for /f "tokens=*" %%v in ('claude --version 2^>nul') do set CLAUDE_VER=%%v
  echo [ok] claude CLI %CLAUDE_VER%
)

REM ============================================================
REM 4) GIT-CHECK (fuer cc per-task-commit feature)
REM ============================================================
where git >nul 2>nul
if errorlevel 1 (
  echo [warn] git nicht gefunden - cc per-task-commits deaktiviert.
  echo        optional installieren: https://git-scm.com/download/win
) else (
  for /f "tokens=*" %%v in ('git --version') do set GIT_VER=%%v
  echo [ok] %GIT_VER%
)

REM ============================================================
REM 5) FLUTTER-CHECK (nur fuer mobile-app-rebuild noetig)
REM ============================================================
set FLUTTER_BIN=%ROOT%Flutter\flutter\bin\flutter.bat
if exist "%FLUTTER_BIN%" (
  echo [ok] flutter SDK lokal verfuegbar
) else (
  where flutter >nul 2>nul
  if errorlevel 1 (
    echo [info] flutter SDK nicht gefunden - mobile-app-rebuild deaktiviert.
    echo        Nur noetig wenn du die mobile-app selbst neu bauen willst.
  ) else (
    echo [ok] flutter SDK ^(global^)
  )
)

echo.
echo ============================================
echo   starte server...
echo ============================================
echo.

REM ============================================================
REM 6) SYNC-SERVER STARTEN
REM ============================================================
echo [1/2] starte ProjectGamma-server  (port 7892)...
start "ProjectGamma . server" cmd /k "cd /d "%SERVER%" && node server.js"

REM 7) ADB-reverse (USB-tunnel fuer handy, optional)
if exist "%ADB%" (
  echo [2/2] adb-reverse tcp:7892 (handy via USB optional)
  "%ADB%" reverse tcp:7892 tcp:7892 2>nul
) else (
  echo [2/2] adb nicht gefunden - handy verbindet via WLAN oder internet-tunnel
)

REM 8) Kurz warten, browser oeffnen.
timeout /t 4 /nobreak >nul
echo.
echo oeffne ProjectGamma im browser...
start "" "http://localhost:7892/"

echo.
echo ============================================
echo   bereit!
echo ============================================
echo.
echo   browser:     http://localhost:7892
echo.
echo   handy verbinden:
echo     - im browser auf "+ handy verbinden" klicken
echo     - QR scannen mit der ProjectGamma-app
echo     - kein gleiches WLAN? -^> "internet-tunnel start" im pair-dialog
echo.
echo   beenden: das server-fenster schliessen ^(oder STRG+C druecken^).
echo.
pause
