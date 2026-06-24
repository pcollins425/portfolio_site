#!/usr/bin/env bash
# Mount NAS tableau images into WSL, for Docker Desktop bind-mount on Windows hosts.
# Docker Desktop cannot CIFS-mount inside the container ("Unable to apply new capability set").
#
# Usage (from repo root, in WSL or via scripts/mount_nas_media_wsl.cmd):
#   bash scripts/mount_nas_media_wsl.sh
#
# Requires NAS_MEDIA_* in backend_live/.env (same vars as container mount).
# Creates /mnt/dgs-nas (CIFS) and /mnt/dgs-nas-media -> subpath symlink (no spaces in bind path).

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
ENV_FILE="$REPO_ROOT/backend_live/.env"

if [[ -f "$ENV_FILE" ]]; then
  while IFS= read -r line || [[ -n "$line" ]]; do
    line="${line//$'\r'/}"
    [[ -z "$line" || "$line" =~ ^[[:space:]]*# ]] && continue
    if [[ "$line" =~ ^(NAS_MEDIA_[A-Z_]+|MEDIA_HEALTH_PROBE)=(.*)$ ]]; then
      key="${BASH_REMATCH[1]}"
      val="${BASH_REMATCH[2]}"
      val="${val%\"}"
      val="${val#\"}"
      export "$key=$val"
    fi
  done <"$ENV_FILE"
fi

SHARE="${NAS_MEDIA_SHARE:-//192.168.1.99/DGS_Analytics}"
SUBPATH="${NAS_MEDIA_SUBPATH:-Paul Collins/tableau images}"
MOUNT_ROOT="/mnt/dgs-nas"
LINK="/mnt/dgs-nas-media"
PROBE="${MEDIA_HEALTH_PROBE:-logos/logo_AGS.png}"

if [[ -z "${NAS_MEDIA_USERNAME:-}" || -z "${NAS_MEDIA_PASSWORD:-}" ]]; then
  echo "NAS_MEDIA_USERNAME and NAS_MEDIA_PASSWORD required in $ENV_FILE" >&2
  exit 1
fi

sudo mkdir -p "$MOUNT_ROOT"

if mountpoint -q "$MOUNT_ROOT" 2>/dev/null; then
  echo "Already mounted: $MOUNT_ROOT"
else
  cred_file="$(mktemp)"
  chmod 600 "$cred_file"
  {
    printf 'username=%s\n' "$NAS_MEDIA_USERNAME"
    printf 'password=%s\n' "$NAS_MEDIA_PASSWORD"
    if [[ -n "${NAS_MEDIA_DOMAIN:-}" ]]; then
      printf 'domain=%s\n' "$NAS_MEDIA_DOMAIN"
    fi
  } >"$cred_file"

  vers="${NAS_MEDIA_CIFS_VERSION:-3.0}"
  echo "Mounting $SHARE -> $MOUNT_ROOT"
  if ! sudo mount -t cifs -o "credentials=${cred_file},ro,vers=${vers},iocharset=utf8,nounix" "$SHARE" "$MOUNT_ROOT"; then
    rm -f "$cred_file"
    echo "CIFS mount failed" >&2
    exit 1
  fi
  rm -f "$cred_file"
fi

resolved="${MOUNT_ROOT}/${SUBPATH}"
if [[ ! -d "$resolved" ]]; then
  echo "NAS subpath not found: $resolved" >&2
  exit 1
fi

sudo ln -sfn "$resolved" "$LINK"

if [[ ! -f "${LINK}/${PROBE}" ]]; then
  echo "WARNING: probe file missing: ${LINK}/${PROBE}" >&2
  exit 1
fi

echo "NAS media ready at $LINK"
echo "Set in backend_live/.env for Docker bind:"
echo "  NAS_MEDIA_MODE=wsl"
echo "  NAS_MEDIA_WSL_BIND=//wsl.localhost/\$(wsl.exe echo -n '\$WSL_DISTRO_NAME')/mnt/dgs-nas-media"
wsl_distro="${WSL_DISTRO_NAME:-Ubuntu}"
echo "  (this distro: $wsl_distro)"
echo "  NAS_MEDIA_WSL_BIND=//wsl.localhost/${wsl_distro}/mnt/dgs-nas-media"
