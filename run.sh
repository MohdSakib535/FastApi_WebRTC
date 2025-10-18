# #!/usr/bin/env bash

# set -euo pipefail

# # Allow overriding host/port via environment variables
# HOST="${HOST:-0.0.0.0}"
# PORT="${PORT:-8000}"
# SSL_CERTFILE="${SSL_CERTFILE:-}"
# SSL_KEYFILE="${SSL_KEYFILE:-}"

# echo "Starting FastAPI WebRTC server on ${HOST}:${PORT}"
# echo "Open http${SSL_CERTFILE:+s}://${HOST}:${PORT} (replace with your machine IP when accessing from other devices)"

# UVICORN_CMD=(uvicorn app.main:app --host "${HOST}" --port "${PORT}" --reload)

# if [[ -n "${SSL_CERTFILE}" && -n "${SSL_KEYFILE}" ]]; then
#   echo "Using TLS certificate: ${SSL_CERTFILE}"
#   echo "Using TLS key: ${SSL_KEYFILE}"
#   UVICORN_CMD+=("--ssl-certfile" "${SSL_CERTFILE}" "--ssl-keyfile" "${SSL_KEYFILE}")
# elif [[ -n "${SSL_CERTFILE}" || -n "${SSL_KEYFILE}" ]]; then
#   echo "Both SSL_CERTFILE and SSL_KEYFILE must be set to enable HTTPS" >&2
#   exit 1
# fi

# exec "${UVICORN_CMD[@]}"
