@echo off
setlocal
REM Mount NAS in WSL, then start backend_live (Docker Desktop on DGS Slot Server).
cd /d "%~dp0.."
call scripts\mount_nas_media_wsl.cmd
if errorlevel 1 exit /b 1
docker compose --env-file backend_live\.env up -d --build
exit /b %ERRORLEVEL%
