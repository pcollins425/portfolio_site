@echo off
setlocal EnableDelayedExpansion

REM Sync NAS tableau images -> MEDIA_ROOT_HOST for Docker bind mount.
REM Reads MEDIA_ROOT_HOST from backend_live\.env when not set in the environment.
REM Default dest (no .env): sibling ../portfolio_media/tableau-images (matches docker-compose).

set "SOURCE=M:\Paul Collins\tableau images"

REM Resolve repo root to an absolute path (avoid scripts\.. + ..\ typos).
pushd "%~dp0.."
set "REPO_ROOT=%CD%"
popd

set "ENV_FILE=%REPO_ROOT%\backend_live\.env"

if not defined MEDIA_ROOT_HOST (
  if exist "%ENV_FILE%" (
    for /f "usebackq eol=# tokens=1,* delims==" %%a in ("%ENV_FILE%") do (
      if /i "%%a"=="MEDIA_ROOT_HOST" set "MEDIA_ROOT_HOST=%%b"
    )
  )
)

if defined MEDIA_ROOT_HOST (
  set "DEST=!MEDIA_ROOT_HOST!"
) else (
  pushd "%REPO_ROOT%\.."
  set "DEST=%CD%\portfolio_media\tableau-images"
  popd
)

REM Normalize .env values: trim quotes, forward slashes -> backslashes.
set "DEST=!DEST:"=!"
set "DEST=!DEST:/=\!"

if not exist "%SOURCE%\" (
  echo ERROR: NAS source not found: %SOURCE%
  echo Is M: mapped to \\192.168.1.99\DGS_Analytics ?
  exit /b 1
)

if not exist "%DEST%\" mkdir "%DEST%"

echo.
echo MEDIA_ROOT_HOST = %DEST%
echo Syncing %SOURCE% -^> %DEST%
echo.
robocopy "%SOURCE%" "%DEST%" /E /FFT /Z /W:2 /R:2
set "RC=%ERRORLEVEL%"
if %RC% GEQ 8 (
  echo robocopy failed with exit code %RC%
  exit /b %RC%
)

echo.
echo Done. No container restart needed — bind mount picks up new files immediately.
echo Verify: Test-Path "%DEST%\cabinets\ags\AGS_Revel.png"
exit /b 0
