# ─────────────────────────────────────────────────────────────────
# AlphaTradingDesk — Makefile
# Usage: make <target>
# ─────────────────────────────────────────────────────────────────
.PHONY: help dev dev-build dev-rebuild-frontend dev-down \
        backend-dev backend-test backend-lint backend-fmt backend-typecheck \
        frontend-install frontend-dev frontend-test frontend-lint frontend-build \
        db-upgrade db-downgrade db-revision db-reset db-seed db-refresh db-recover \
        clean

COMPOSE      := docker compose -f docker-compose.dev.yml
POETRY       := poetry run
FRONTEND_DIR := frontend

## ── Help ─────────────────────────────────────────────────────────
help: ## Show this help
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) \
	  | awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-28s\033[0m %s\n", $$1, $$2}'

## ── Docker Compose dev stack ─────────────────────────────────────
dev: ## Start full dev stack (db + backend + frontend + adminer)
	$(COMPOSE) up

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
	$(POETRY) uvicorn src.main:app --host 0.0.0.0 --port 8000 --reload

backend-test: ## Run backend tests
	$(POETRY) pytest tests/ -v

backend-test-cov: ## Run backend tests with coverage
	$(POETRY) pytest tests/ --cov=src --cov-report=term-missing

backend-lint: ## Run ruff linter
	$(POETRY) ruff check src/ tests/

backend-fmt: ## Auto-fix ruff + format
	$(POETRY) ruff check --fix src/ tests/
	$(POETRY) ruff format src/ tests/

backend-typecheck: ## Run mypy type checker
	$(POETRY) mypy src/

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
db-upgrade: ## Apply all pending Alembic migrations
	$(POETRY) alembic upgrade head

db-downgrade: ## Roll back last Alembic migration
	$(POETRY) alembic downgrade -1

db-revision: ## Generate new Alembic migration (usage: make db-revision msg="add users table")
	$(POETRY) alembic revision --autogenerate -m "$(msg)"

db-reset: ## Drop and recreate the dev DB (DESTRUCTIVE!)
	$(COMPOSE) exec db psql -U atd -c "DROP DATABASE IF EXISTS atd_dev;" postgres
	$(COMPOSE) exec db psql -U atd -c "CREATE DATABASE atd_dev;" postgres
	$(MAKE) db-upgrade

db-seed: ## Run all seed scripts (idempotent — safe to re-run)
	$(POETRY) python -m database.migrations.seeds.seed_all

db-refresh: ## Reset DB + re-apply migrations + re-seed (full clean slate, DESTRUCTIVE!)
	$(MAKE) db-reset
	$(MAKE) db-seed

db-recover: ## Recover from stale alembic_version (schema wiped but version row survived — no DROP needed)
	$(COMPOSE) exec db psql -U atd -d atd_dev -c "DELETE FROM alembic_version;"
	APP_ENV=dev PYTHONPATH=. $(POETRY) alembic upgrade head
	APP_ENV=dev PYTHONPATH=. $(POETRY) python database/migrations/seeds/seed_all.py

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
