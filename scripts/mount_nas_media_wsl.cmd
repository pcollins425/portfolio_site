@echo off
setlocal
REM Mount NAS tableau images in WSL for Docker Desktop bind (see mount_nas_media_wsl.sh).
pushd "%~dp0.."
for /f "delimiters=" %%i in ('wsl.exe wslpath -a "%CD%"') do set "WSL_REPO=%%i"
wsl.exe -e bash "%WSL_REPO%/scripts/mount_nas_media_wsl.sh"
set "RC=%ERRORLEVEL%"
popd
exit /b %RC%
