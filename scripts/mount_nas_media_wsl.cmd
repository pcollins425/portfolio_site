@echo off
setlocal EnableDelayedExpansion
REM Mount NAS tableau images in WSL for Docker Desktop bind (see mount_nas_media_wsl.sh).
pushd "%~dp0.."

set "WSL_DISTRO="
for /f "tokens=1" %%d in ('wsl.exe -l -q') do (
  set "name=%%d"
  set "name=!name: =!"
  if /i not "!name!"=="docker-desktop" if /i not "!name!"=="docker-desktop-data" (
    if not defined WSL_DISTRO set "WSL_DISTRO=!name!"
  )
)

if not defined WSL_DISTRO (
  echo ERROR: No user WSL distro found. Only docker-desktop is installed.
  echo Install Ubuntu, then re-run:
  echo   wsl --install -d Ubuntu
  echo Or: Microsoft Store -^> Ubuntu
  popd
  exit /b 1
)

echo Using WSL distro: %WSL_DISTRO%
for /f "delimiters=" %%i in ('wsl.exe -d "%WSL_DISTRO%" wslpath -a "%CD%"') do set "WSL_REPO=%%i"
wsl.exe -d "%WSL_DISTRO%" -e bash "%WSL_REPO%/scripts/mount_nas_media_wsl.sh"
set "RC=%ERRORLEVEL%"
popd
exit /b %RC%
