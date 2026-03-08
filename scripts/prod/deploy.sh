#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# scripts/prod/deploy.sh
#
# PURPOSE
#   Rolling deploy on the Dell production server.
#   Called by GitHub Actions (atd-deploy.yml) via SSH after every merge to main
#   that bumps the version.  Can also be called manually:
#     ~/apps/deploy.sh v1.2.3
#     ~/apps/deploy.sh latest
#
# WHAT IT DOES (in order)
#   1. Pull new backend image from GHCR
#   2. Pull new frontend image from GHCR
#   3. Rolling restart: only backend + frontend containers — DB never restarted
#   4. Run any pending Alembic migrations inside the new backend container
#   5. Prune images older than 72h to free disk space
#
# WHY "rolling restart" and not "down + up"?
#   docker compose up -d --no-build  replaces containers one by one.
#   The DB container is never touched, so all data stays live during the deploy.
#   Total downtime: ~5 seconds while the backend container restarts.
#
# PREREQUISITES (already set up by setup-server.sh)
#   - ~/apps/docker-compose.prod.yml  — compose file
#   - ~/apps/.env                     — runtime secrets
#   - /srv/atd/...                    — bind-mount directories
#   - GHCR_OWNER env var set here or exported before calling
#
# USAGE
#   ~/apps/deploy.sh v1.2.3          # deploy specific version
#   ~/apps/deploy.sh latest          # deploy latest tag (manual hotfix)
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

VERSION="${1:-latest}"

# ── Config ────────────────────────────────────────────────────────────────────
# GHCR_OWNER is the GitHub organisation or username (lowercase).
# Must be set via the environment — injected by CI/CD or exported manually:
#   export GHCR_OWNER=your-github-org && ~/apps/deploy.sh v1.2.3
# Never hardcoded here to keep the script fully generic.
if [[ -z "${GHCR_OWNER:-}" ]]; then
  echo "❌  GHCR_OWNER is not set. Export it before calling this script:"
  echo "    export GHCR_OWNER=<your-github-org-or-username>"
  exit 1
fi
COMPOSE_FILE="$HOME/apps/docker-compose.prod.yml"
BACKEND_IMAGE="ghcr.io/${GHCR_OWNER}/atd-backend"
FRONTEND_IMAGE="ghcr.io/${GHCR_OWNER}/atd-frontend"

echo "──────────────────────────────────────────────────"
echo "🚀  ATD deploy — version: ${VERSION}"
echo "    Backend  : ${BACKEND_IMAGE}:${VERSION}"
echo "    Frontend : ${FRONTEND_IMAGE}:${VERSION}"
echo "──────────────────────────────────────────────────"

# ── 1. Pull images ─────────────────────────────────────────────────────────────
echo "📦  Pulling images…"
docker pull "${BACKEND_IMAGE}:${VERSION}"
docker pull "${FRONTEND_IMAGE}:${VERSION}"

# ── 2. Export vars for compose interpolation ───────────────────────────────────
export IMAGE_TAG="${VERSION}"
export GHCR_OWNER="${GHCR_OWNER}"

# ── 3. Rolling restart (backend + frontend only — DB untouched) ───────────────
echo "♻️   Rolling restart (backend + frontend)…"
docker compose -f "${COMPOSE_FILE}" up -d --no-build backend frontend

# ── 4. Run pending Alembic migrations ─────────────────────────────────────────
# The entrypoint already runs alembic upgrade head + seed_all, but we run them
# explicitly here as well as a safety net — idempotent, safe to call twice.
echo "🔄  Running Alembic migrations…"
docker compose -f "${COMPOSE_FILE}" exec -T backend alembic upgrade head

# ── 4b. Seed reference data (idempotent) ──────────────────────────────────────
# Guarantees brokers, instruments, trading_styles, sessions etc. are always
# present in prod, even if the entrypoint seed step failed on a previous deploy.
# INSERT ON CONFLICT DO NOTHING — user data is NEVER touched.
echo "🌱  Seeding reference data…"
docker compose -f "${COMPOSE_FILE}" exec -T backend \
  python -m database.migrations.seeds.seed_all

# ── 5. Prune old images (keep last 72h) ───────────────────────────────────────
echo "🧹  Pruning old images…"
docker image prune -f --filter "until=72h"

echo "──────────────────────────────────────────────────"
echo "✅  ATD ${VERSION} deployed"
echo "──────────────────────────────────────────────────"
