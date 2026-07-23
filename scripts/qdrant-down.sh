#!/usr/bin/env bash
# Sprint 10 / B-10-4 — stop the local Qdrant container. Idempotent.
set -euo pipefail

CONTAINER_NAME="${QDRANT_CONTAINER_NAME:-weather-qdrant}"

if ! docker ps --format '{{.Names}}' | grep -q "^${CONTAINER_NAME}$"; then
  echo "[qdrant-down] container '${CONTAINER_NAME}' not running"
  exit 0
fi

docker stop "${CONTAINER_NAME}" >/dev/null
echo "[qdrant-down] stopped '${CONTAINER_NAME}'"
