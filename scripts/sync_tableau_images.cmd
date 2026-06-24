@echo off
setlocal

REM Sync NAS tableau images -> MEDIA_ROOT_HOST for Docker bind mount.
REM Does not require PowerShell script execution policy (uses robocopy directly).
REM
REM Override dest:
REM   set MEDIA_ROOT_HOST=D:\dgs\tableau-images
REM   scripts\sync_tableau_images.cmd

set "SOURCE=M:\Paul Collins\tableau images"

if defined MEDIA_ROOT_HOST (
  set "DEST=%MEDIA_ROOT_HOST%"
) else (
  set "DEST=%~dp0..\portfolio_media\tableau-images"
)

if not exist "%SOURCE%\" (
  echo ERROR: NAS source not found: %SOURCE%
  echo Is M: mapped to \\192.168.1.99\DGS_Analytics ?
  exit /b 1
)

if not exist "%DEST%\" mkdir "%DEST%"

echo Syncing %SOURCE% -^> %DEST%
robocopy "%SOURCE%" "%DEST%" /E /FFT /Z /W:2 /R:2
set "RC=%ERRORLEVEL%"
if %RC% GEQ 8 (
  echo robocopy failed with exit code %RC%
  exit /b %RC%
)

echo Done. No container restart needed — bind mount picks up new files immediately.
echo Verify: Test-Path "%DEST%\cabinets\ags\AGS_Spectra_43.png"
exit /b 0
