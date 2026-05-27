@echo off
setlocal
cd /d "%~dp0..\backend_live"
if exist "%CD%\.venv\Scripts\python.exe" (
  "%CD%\.venv\Scripts\python.exe" run.py
) else (
  py -3 run.py
)
