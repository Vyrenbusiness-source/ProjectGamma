@echo off
REM ProjectGamma . update — holt die neueste version von github + restart.
REM
REM Zwei modi automatisch erkannt:
REM   1^) GIT-MODE: wenn .git ordner vorhanden -^> git pull ^(nur diff, schnell^)
REM   2^) ZIP-MODE: kein .git -^> ZIP von github downloaden + drueberkopieren
REM      ^(USER-DATA bleibt: DBs, sessions, uploads, accounts^)
REM
REM Team-tunnel-gaeste muessen nichts machen — sie laden die UI eh vom
REM owner-server und sehen das update beim naechsten F5.

title ProjectGamma . update

setlocal enabledelayedexpansion
set ROOT=%~dp0
set SERVER=%ROOT%sync-server

REM Github-Repo URL fuer den ZIP-fallback. WICHTIG: wenn du forkst,
REM diesen wert auf dein eigenes repo anpassen.
set GH_REPO=Vyrenbusiness-source/ProjectGamma
set GH_BRANCH=main
set ZIP_URL=https://codeload.github.com/%GH_REPO%/zip/refs/heads/%GH_BRANCH%

echo ============================================
echo   ProjectGamma . update
echo ============================================
echo.

REM ============================================================
REM 1) LAUFENDEN SERVER STOPPEN
REM    a^) per fenster-titel ^("ProjectGamma . server"^)
REM    b^) fallback: alles auf port 7892 killen.
REM ============================================================
echo [1/5] stoppe laufenden server...
taskkill /F /FI "WINDOWTITLE eq ProjectGamma . server*" >nul 2>nul
for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":7892" ^| findstr "LISTENING" 2^>nul') do (
  taskkill /F /PID %%a >nul 2>nul
)
timeout /t 2 /nobreak >nul

REM ============================================================
REM 2) MODE-DETECTION: .git vorhanden -^> git-pull, sonst -^> ZIP
REM ============================================================
if exist "%ROOT%.git" (
  echo [2/5] modus: git-clone erkannt -^> git pull
  goto :GIT_MODE
) else (
  echo [2/5] modus: ZIP-installation erkannt -^> download von github
  goto :ZIP_MODE
)


REM ============================================================
:GIT_MODE
REM ============================================================
where git >nul 2>nul
if errorlevel 1 (
  echo [FEHLER] git nicht installiert obwohl .git existiert.
  echo   Installieren: https://git-scm.com/download/win
  pause
  exit /b 1
)
echo [3/5] hole neueste version aus github...
pushd "%ROOT%"
git fetch origin %GH_BRANCH%
if errorlevel 1 (
  echo [FEHLER] git fetch fehlgeschlagen. Internet pruefen.
  popd
  pause
  exit /b 1
)
git pull --ff-only origin %GH_BRANCH%
if errorlevel 1 (
  echo.
  echo [WARN] git pull --ff-only fehlgeschlagen — lokale aenderungen kollidieren.
  echo   Optionen:
  echo     1^) lokale aenderungen committen:   git commit -am "lokal"
  echo     2^) lokale aenderungen verwerfen:    git reset --hard origin/%GH_BRANCH%
  echo     3^) update jetzt abbrechen.
  echo.
  popd
  pause
  exit /b 1
)
popd
goto :NPM_INSTALL


REM ============================================================
:ZIP_MODE
REM ============================================================
REM Pruefen ob curl + powershell vorhanden ^(beide ab Win10 default^)
where curl >nul 2>nul
if errorlevel 1 (
  echo [FEHLER] curl nicht gefunden. Win10+ noetig oder manuell ZIP runterladen:
  echo   %ZIP_URL%
  pause
  exit /b 1
)
where powershell >nul 2>nul
if errorlevel 1 (
  echo [FEHLER] powershell nicht gefunden. Win10+ noetig.
  pause
  exit /b 1
)

set TMP_ZIP=%TEMP%\pg-update-%RANDOM%.zip
set TMP_DIR=%TEMP%\pg-update-%RANDOM%-extract

echo [3/5] downloade neueste version^(%ZIP_URL%^)...
curl -L -f -o "%TMP_ZIP%" "%ZIP_URL%"
if errorlevel 1 (
  echo [FEHLER] download fehlgeschlagen. Internet ok? URL korrekt?
  pause
  exit /b 1
)

echo [3.5/5] entpacke...
if exist "%TMP_DIR%" rmdir /s /q "%TMP_DIR%"
mkdir "%TMP_DIR%"
powershell -NoProfile -Command "Expand-Archive -Path '%TMP_ZIP%' -DestinationPath '%TMP_DIR%' -Force"
if errorlevel 1 (
  echo [FEHLER] entpacken fehlgeschlagen.
  del /q "%TMP_ZIP%" 2>nul
  pause
  exit /b 1
)

REM Github-zips packen alles in <repo>-<branch>\... — wir finden den ersten
REM subordner und kopieren dessen inhalt drueber.
set EXTRACTED_DIR=
for /d %%d in ("%TMP_DIR%\*") do set EXTRACTED_DIR=%%d
if "%EXTRACTED_DIR%"=="" (
  echo [FEHLER] keine extracted-dir gefunden in %TMP_DIR%
  pause
  exit /b 1
)

echo [3.7/5] aktualisiere files ^(USER-DATA wird geschont^)...
REM Vorher: robocopy hatte exitcode-16-bug bei manchen setups. Jetzt:
REM PowerShell-basiertes copy mit explizitem exclude-pattern. robuster
REM gegen pfade mit umlauten/spaces + bessere fehlerausgabe.
REM USER-DATA-EXCLUDES: DBs, sessions, locks bleiben unangetastet.
powershell -NoProfile -ExecutionPolicy Bypass -Command "$src='%EXTRACTED_DIR%'; $dst='%ROOT%'; $excludeFiles=@('*.sqlite','*.sqlite-wal','*.sqlite-shm','*.db','*.db-wal','*.db-shm','sessions.json','state.json','store.json','.tunnel-security-fixed-v1'); $excludeDirs=@('.git','node_modules','.pg-uploads','.pg-archives'); try { Get-ChildItem -Path $src -Recurse -Force | ForEach-Object { $rel = $_.FullName.Substring($src.Length).TrimStart('\\'); $skip = $false; foreach ($d in $excludeDirs) { if ($rel -like \"$d\\*\" -or $rel -eq $d) { $skip=$true; break } }; if ($skip) { return }; if ($_.PSIsContainer) { return }; foreach ($p in $excludeFiles) { if ($_.Name -like $p) { $skip=$true; break } }; if ($skip) { return }; $target = Join-Path $dst $rel; $parent = Split-Path $target -Parent; if (-not (Test-Path $parent)) { New-Item -ItemType Directory -Path $parent -Force | Out-Null }; Copy-Item -Path $_.FullName -Destination $target -Force }; exit 0 } catch { Write-Error $_.Exception.Message; exit 1 }"
if errorlevel 1 (
  echo [FEHLER] copy fehlgeschlagen.
  pause
  exit /b 1
)

REM Cleanup temp
del /q "%TMP_ZIP%" 2>nul
rmdir /s /q "%TMP_DIR%" 2>nul

echo [ok] files aktualisiert.


REM ============================================================
:NPM_INSTALL
REM ============================================================
echo [4/5] dependencies pruefen...
pushd "%SERVER%"
call npm install --omit=dev --silent
popd

REM ============================================================
REM 5) SERVER NEU STARTEN
REM ============================================================
echo [5/5] server neu starten...
echo.
echo TIPP: andere benutzer auf DEINEM tunnel sehen das update beim
echo       naechsten F5 ^(server-restart triggert update-banner^).
echo       Andere normal-user mit eigener installation brauchen
echo       ihre EIGENE update.bat zu druecken.
echo.

start "ProjectGamma . relaunch" cmd /c "%ROOT%start.bat"

echo ============================================
echo   update fertig.
echo ============================================
echo.
timeout /t 4 /nobreak >nul
exit /b 0
