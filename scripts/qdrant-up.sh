#!/usr/bin/env bash
# Sprint 10 / B-10-4 — start a local Qdrant container for the project
# indexer. Idempotent: re-running with the container already up is a
# no-op.
set -euo pipefail

CONTAINER_NAME="${QDRANT_CONTAINER_NAME:-weather-qdrant}"
PORT="${QDRANT_PORT:-6333}"
GRPC_PORT="${QDRANT_GRPC_PORT:-6334}"

if docker ps --format '{{.Names}}' | grep -q "^${CONTAINER_NAME}$"; then
  echo "[qdrant-up] container '${CONTAINER_NAME}' already running"
  exit 0
fi

if docker ps -a --format '{{.Names}}' | grep -q "^${CONTAINER_NAME}$"; then
  echo "[qdrant-up] starting existing container '${CONTAINER_NAME}'"
  docker start "${CONTAINER_NAME}" >/dev/null
else
  echo "[qdrant-up] creating container '${CONTAINER_NAME}'"
  docker run -d \
    --name "${CONTAINER_NAME}" \
    -p "${PORT}:6333" \
    -p "${GRPC_PORT}:6334" \
    -v qdrant_storage:/qdrant/storage \
    qdrant/qdrant:latest >/dev/null
fi

# Wait until the HTTP endpoint responds.
for i in $(seq 1 30); do
  if curl -fsS "http://localhost:${PORT}/healthz" >/dev/null 2>&1; then
    echo "[qdrant-up] ready at http://localhost:${PORT}"
    exit 0
  fi
  sleep 1
done
echo "[qdrant-up] failed to reach Qdrant on port ${PORT}" >&2
exit 1
