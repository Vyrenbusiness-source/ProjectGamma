@echo off
REM ProjectGamma · One-Click-Start
REM Startet Sync-Server (port 7892) + Desktop-HTTP-Server (port 7891)
REM und oeffnet die Desktop-App im Standard-Browser.

setlocal
set ROOT=%~dp0
set DESKTOP=%ROOT%desktop-app
set SERVER=%ROOT%sync-server
set ADB=%LOCALAPPDATA%\Android\Sdk\platform-tools\adb.exe

echo ============================================
echo   ProjectGamma · Start
echo ============================================
echo.
echo  ROOT:    %ROOT%
echo  Server:  %SERVER%
echo  Desktop: %DESKTOP%
echo.

REM 1) Sync-Server (Port 7892, Node)
echo [1/3] Starte Sync-Server (Port 7892)...
start "ProjectGamma · Sync-Server" cmd /k "cd /d "%SERVER%" && node server.js"

REM 2) Desktop-Static-Server (Port 7891)
echo [2/3] Starte Desktop-HTTP-Server (Port 7891)...
start "ProjectGamma · Desktop-Server" cmd /k "cd /d "%DESKTOP%" && python -m http.server 7891"

REM 3) ADB-Reverse fuer Phone (USB-Tethering optional)
if exist "%ADB%" (
  echo [3/3] ADB-Reverse-Tunnel (Port 7892, falls Phone via USB)...
  "%ADB%" reverse tcp:7892 tcp:7892 2>nul
) else (
  echo [3/3] ADB nicht gefunden - Phone muss LAN-IP nutzen.
)

REM Kurz warten, dann Browser oeffnen
timeout /t 3 /nobreak >nul
echo.
echo Oeffne Desktop-App im Browser...
start "" "http://localhost:7891/index.html"

echo.
echo ============================================
echo   Bereit!
echo ============================================
echo.
echo   Desktop:    http://localhost:7891
echo   Sync-API:   http://localhost:7892
echo   Mobile-IP:  siehe Sync-Server-Fenster (LAN-IPs)
echo.
echo   Schliesse diese Fenster (oder STRG+C in den Server-Fenstern)
echo   um das Programm zu beenden.
echo.
pause
