@echo off
REM ProjectGamma · One-Click-Start
REM Doppelklick startet alles: deps installieren -> server -> browser oeffnen
REM Voraussetzung: Node.js (https://nodejs.org/de/download).
title ProjectGamma . launcher

setlocal
set ROOT=%~dp0
set SERVER=%ROOT%sync-server
set ADB=%LOCALAPPDATA%\Android\Sdk\platform-tools\adb.exe

echo ============================================
echo   ProjectGamma . launcher
echo ============================================
echo.

REM 1) Node-check
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

REM 2) Erstinstall der abhaengigkeiten (express, ws, cors, nat-upnp).
REM    Lauft NUR wenn node_modules fehlt -> kein delay bei normalem start.
if not exist "%SERVER%\node_modules" (
  echo [setup] erste installation - abhaengigkeiten herunterladen...
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
  echo [setup] fertig.
  echo.
)

REM 3) Sync-Server starten (serviert auch die desktop-app static auf port 7892).
echo [1/2] starte ProjectGamma-server  (port 7892)...
start "ProjectGamma . server" cmd /k "cd /d "%SERVER%" && node server.js"

REM 4) ADB-reverse (USB-tunnel fuer handy, optional)
if exist "%ADB%" (
  echo [2/2] adb-reverse tcp:7892 (handy via USB optional)
  "%ADB%" reverse tcp:7892 tcp:7892 2>nul
) else (
  echo [2/2] adb nicht gefunden - handy verbindet via WLAN oder internet-tunnel
)

REM 5) Kurz warten, browser oeffnen.
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
echo     - QR scannen mit der ProjectGamma-app (APK in mobile\)
echo     - kein gleiches WLAN? -> "internet-tunnel start" im pair-dialog
echo.
echo   beenden: das server-fenster schliessen (oder STRG+C drueck en).
echo.
pause
