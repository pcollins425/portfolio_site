#!/bin/bash
# Start API — SMB media mode needs no NAS mount; WSL/container modes handled in entrypoint.
set -euo pipefail

if [ -d /workspace/scripts/fsr_intake ]; then
  echo "docker-entrypoint: FSR apply tooling present at /workspace/scripts/fsr_intake"
else
  echo "docker-entrypoint: WARNING — /workspace/scripts/fsr_intake missing (FSR Apply will 503)."
  echo "docker-entrypoint: On Slot Server set ASSISTANT_WORKSPACE_HOST=C:/Users/DGS Slot Server/cursor-assistant"
  echo "docker-entrypoint: then: docker compose --env-file backend_live/.env up -d --force-recreate"
  ls -la /workspace 2>/dev/null | head -20 || echo "docker-entrypoint: /workspace is empty or unmounted"
fi

mode="$(printf '%s' "${NAS_MEDIA_MODE:-}" | tr -d '\r\n' | tr '[:upper:]' '[:lower:]')"
if [ "$mode" = "smb" ]; then
  echo "docker-entrypoint: NAS_MEDIA_MODE=smb — reading media over SMB (no mount)"
  exec "$@"
fi

media_bind="/media/tableau-images"
probe="${MEDIA_HEALTH_PROBE:-logos/logo_AGS.png}"

use_bind_mount() {
  if [ -f "${media_bind}/${probe}" ]; then
    export MEDIA_ROOT="$media_bind"
    echo "docker-entrypoint: using bind-mounted MEDIA_ROOT=${MEDIA_ROOT}"
    return 0
  fi
  return 1
}

mount_nas_media() {
  local mode="${NAS_MEDIA_MODE:-container}"
  if [ "$mode" = "wsl" ] || [ "$mode" = "off" ]; then
    if use_bind_mount; then
      return 0
    fi
    if [ "$mode" = "wsl" ]; then
      echo "docker-entrypoint: NAS_MEDIA_MODE=wsl but bind mount missing at ${media_bind}" >&2
      echo "docker-entrypoint: run scripts/mount_nas_media_wsl.cmd on the host first" >&2
      exit 1
    fi
    return 0
  fi

  if use_bind_mount; then
    return 0
  fi

  local share="${NAS_MEDIA_SHARE:-}"
  if [ -z "$share" ]; then
    return 0
  fi

  if [ -z "${NAS_MEDIA_USERNAME:-}" ] || [ -z "${NAS_MEDIA_PASSWORD:-}" ]; then
    echo "docker-entrypoint: NAS_MEDIA_SHARE is set but NAS_MEDIA_USERNAME/PASSWORD are missing" >&2
    exit 1
  fi

  local mount_point="/media/nas-root"
  mkdir -p "$mount_point"

  if mountpoint -q "$mount_point"; then
    echo "docker-entrypoint: $mount_point already mounted"
  else
    local cred_file
    cred_file="$(mktemp)"
    chmod 600 "$cred_file"
    {
      printf 'username=%s\n' "$NAS_MEDIA_USERNAME"
      printf 'password=%s\n' "$NAS_MEDIA_PASSWORD"
      if [ -n "${NAS_MEDIA_DOMAIN:-}" ]; then
        printf 'domain=%s\n' "$NAS_MEDIA_DOMAIN"
      fi
    } >"$cred_file"

    local vers="${NAS_MEDIA_CIFS_VERSION:-3.0}"
    local opts="credentials=${cred_file},ro,vers=${vers},iocharset=utf8,nounix,uid=0,gid=0,file_mode=0444,dir_mode=0555"

    echo "docker-entrypoint: mounting ${share} -> ${mount_point}"
    if ! mount -t cifs -o "$opts" "$share" "$mount_point"; then
      rm -f "$cred_file"
      echo "docker-entrypoint: CIFS mount failed (use NAS_MEDIA_MODE=smb on Docker Desktop)" >&2
      exit 1
    fi
    rm -f "$cred_file"
  fi

  local subpath="${NAS_MEDIA_SUBPATH:-Paul Collins/tableau images}"
  local resolved="${mount_point}/${subpath}"
  if [ ! -d "$resolved" ]; then
    echo "docker-entrypoint: NAS subpath not found: ${resolved}" >&2
    exit 1
  fi

  export MEDIA_ROOT="$resolved"
  echo "docker-entrypoint: MEDIA_ROOT=${MEDIA_ROOT}"
}

mount_nas_media
exec "$@"
