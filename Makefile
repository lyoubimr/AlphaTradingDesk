# ─────────────────────────────────────────────────────────────────
# AlphaTradingDesk — Makefile
# Usage: make <target>
# ─────────────────────────────────────────────────────────────────
.PHONY: help dev dev-up dev-build dev-rebuild-frontend dev-down \
        backend-dev backend-test backend-lint backend-fmt backend-typecheck \
        frontend-install frontend-dev frontend-test frontend-lint frontend-build \
        db-upgrade db-downgrade db-current db-history db-revision db-reset db-seed db-seed-test db-refresh db-recover \
        clean

COMPOSE      := docker compose -f docker-compose.dev.yml
# Use the in-project venv directly — poetry is not required on PATH.
# All Python commands go through .venv/bin/* (created by `poetry install`).
PYTHON       := .venv/bin/python
ALEMBIC      := APP_ENV=dev .venv/bin/alembic
PYTEST       := .venv/bin/pytest
RUFF         := .venv/bin/ruff
MYPY         := .venv/bin/mypy
FRONTEND_DIR := frontend

## ── Help ─────────────────────────────────────────────────────────
help: ## Show this help
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) \
	  | awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-28s\033[0m %s\n", $$1, $$2}'

## ── Docker Compose dev stack ─────────────────────────────────────
dev: ## Start full dev stack (db + backend + frontend + adminer)
	$(COMPOSE) up

dev-up: ## Start stack detached + auto-migrate + auto-seed (safe to re-run)
	$(COMPOSE) up -d
	@echo "⏳ Waiting for DB to be healthy…"
	@until $(COMPOSE) exec -T db pg_isready -U atd -d atd_dev > /dev/null 2>&1; do sleep 1; done
	@echo "✅ DB ready — running migrations…"
	$(MAKE) db-upgrade
	@echo "✅ Migrations done — seeding reference data…"
	$(MAKE) db-seed
	@echo "🚀 Stack ready — backend: http://localhost:8000  frontend: http://localhost:5173"

dev-build: ## Rebuild images and start dev stack
	$(COMPOSE) up --build

dev-rebuild-frontend: ## Force rebuild frontend image (run after npm install / package.json changes)
	$(COMPOSE) build --no-cache frontend
	$(COMPOSE) up -d frontend

dev-down: ## Stop and remove dev stack containers
	$(COMPOSE) down

dev-logs: ## Follow logs for all services
	$(COMPOSE) logs -f

## ── Backend (local, no Docker) ───────────────────────────────────
backend-dev: ## Run FastAPI dev server locally (hot-reload)
	APP_ENV=dev $(PYTHON) -m uvicorn src.main:app --host 0.0.0.0 --port 8000 --reload

backend-test: ## Run backend tests
	APP_ENV=test $(PYTEST) tests/ -v

backend-test-cov: ## Run backend tests with coverage
	APP_ENV=test $(PYTEST) tests/ --cov=src --cov-report=term-missing

backend-lint: ## Run ruff linter
	$(RUFF) check src/ tests/

backend-fmt: ## Auto-fix ruff + format
	$(RUFF) check --fix src/ tests/
	$(RUFF) format src/ tests/

backend-typecheck: ## Run mypy type checker
	$(MYPY) src/

## ── Frontend (local, no Docker) ──────────────────────────────────
frontend-install: ## Install frontend npm dependencies
	cd $(FRONTEND_DIR) && npm install

frontend-dev: ## Run Vite dev server locally
	cd $(FRONTEND_DIR) && npm run dev

frontend-test: ## Run frontend tests (vitest)
	cd $(FRONTEND_DIR) && npm test

frontend-lint: ## Run frontend ESLint
	cd $(FRONTEND_DIR) && npm run lint

frontend-build: ## Build frontend for production
	cd $(FRONTEND_DIR) && npm run build

## ── Database / Alembic ───────────────────────────────────────────
# All migration commands run inside the backend container where the DB is
# reachable via the "db" service name (no localhost port-forwarding involved).
# The alembic.ini and migrations are mounted via docker-compose volumes.
# -T disables pseudo-TTY allocation — required when running from scripts/CI.
db-upgrade: ## Apply all pending Alembic migrations
	$(COMPOSE) exec -T backend alembic upgrade head

db-downgrade: ## Roll back last Alembic migration
	$(COMPOSE) exec -T backend alembic downgrade -1

db-current: ## Show current Alembic revision
	$(COMPOSE) exec -T backend alembic current

db-history: ## Show Alembic migration history
	$(COMPOSE) exec -T backend alembic history

db-revision: ## Generate new Alembic migration (usage: make db-revision msg="add users table")
	$(COMPOSE) exec -T backend alembic revision --autogenerate -m "$(msg)"

db-reset: ## Drop and recreate the dev DB (DESTRUCTIVE!)
	$(COMPOSE) exec -T db psql -U atd -c "DROP DATABASE IF EXISTS atd_dev;" postgres
	$(COMPOSE) exec -T db psql -U atd -c "CREATE DATABASE atd_dev;" postgres
	$(MAKE) db-upgrade

db-seed: ## Run all seed scripts (idempotent — safe to re-run)
	$(COMPOSE) exec -T backend python -m database.migrations.seeds.seed_all

db-seed-test: ## Inject test profiles + trades for dev (Crypto + CFD, idempotent)
	$(COMPOSE) exec -T backend python -m database.migrations.seeds.seed_test_data

db-refresh: ## Reset DB + re-apply migrations + re-seed (full clean slate, DESTRUCTIVE!)
	$(MAKE) db-reset
	$(MAKE) db-seed

db-recover: ## Recover from stale alembic_version (schema wiped but stamp survived)
	@echo "→ Removing stale alembic_version stamp…"
	$(COMPOSE) exec -T db psql -U atd -d atd_dev -c "DELETE FROM alembic_version;"
	@echo "→ Running all migrations from base…"
	$(COMPOSE) exec -T backend alembic upgrade head
	@echo "✓ DB recovered and up to date."

## ── CI checks (run same checks as GitHub Actions) ────────────────
ci-backend: backend-lint backend-typecheck backend-test ## Run all backend CI checks locally

ci-frontend: frontend-lint frontend-test ## Run all frontend CI checks locally

ci: ci-backend ci-frontend ## Run all CI checks locally

## ── Housekeeping ─────────────────────────────────────────────────
clean: ## Remove Python cache files and build artifacts
	find . -type d -name "__pycache__" -exec rm -rf {} + 2>/dev/null || true
	find . -type d -name ".pytest_cache" -exec rm -rf {} + 2>/dev/null || true
	find . -type d -name ".mypy_cache"   -exec rm -rf {} + 2>/dev/null || true
	rm -rf $(FRONTEND_DIR)/dist
	@echo "Clean done."
