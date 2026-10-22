@echo off
REM Serve Analytics Compliance from the NAS to the live API (files stay on the share).
REM Docker cannot reach 192.168.1.99 from inside the container on this host.
setlocal EnableDelayedExpansion
cd /d "%~dp0.."

REM Prefer an already-mapped Analytics drive; else UNC (may prompt once).
if exist "X:\Compliance\" (
  set "COMPLIANCE_NAS_ROOT=X:\Compliance"
) else if exist "Z:\Compliance\" (
  set "COMPLIANCE_NAS_ROOT=Z:\Compliance"
) else if exist "M:\Compliance\" (
  set "COMPLIANCE_NAS_ROOT=M:\Compliance"
) else (
  set "COMPLIANCE_NAS_ROOT=\\192.168.1.99\DGS_Analytics\Compliance"
)

set "COMPLIANCE_PROXY_HOST=0.0.0.0"
set "COMPLIANCE_PROXY_PORT=9124"

echo Root: %COMPLIANCE_NAS_ROOT%
echo Starting Compliance NAS proxy on 0.0.0.0:%COMPLIANCE_PROXY_PORT% ...
python "%~dp0compliance_nas_proxy.py"
