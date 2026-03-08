# AlphaTradingDesk — Backend

**Stack:** FastAPI · Python 3.11 · SQLAlchemy 2.0 · Pydantic v2 · uvicorn · Poetry

---

## Structure `src/`

```
src/
├── main.py                → entry point FastAPI
│   ├── app = FastAPI()
│   ├── CORS middleware    (ALLOWED_ORIGINS depuis config)
│   ├── include routers    (tous les modules)
│   └── uploads dir check  (crée /app/uploads si absent)
│
├── core/
│   ├── config.py          → Settings (pydantic-settings) — toutes les vars d'env
│   ├── database.py        → engine + SessionLocal + get_db() + _normalise_db_url
│   ├── deps.py            → Depends(get_db) — injectée dans tous les routers
│   └── models/            → SQLAlchemy ORM models
│       ├── trade.py
│       ├── profile.py
│       ├── strategy.py
│       └── ...
│
├── trades/
│   ├── router.py          → @router.get/post/patch/delete /api/trades
│   ├── service.py         → business logic (open/close/partial/stats)
│   └── schemas.py         → Pydantic (TradeCreate, TradeOut, etc.)
│
├── strategies/            → même structure (router + service + schemas)
├── goals/
├── market_analysis/
├── profiles/
├── brokers/
└── stats/
```

### Pattern par module

```
router.py   → routes FastAPI uniquement (validation auto via schemas)
service.py  → toute la logique métier (pas de SQL direct dans les routers)
schemas.py  → Pydantic IN/OUT séparés des modèles SQLAlchemy
```

---

## Configuration — `src/core/config.py`

```python
class Settings(BaseSettings):
    app_env: str = "dev"
    database_url: str           # TOUJOURS depuis l'env — pas de valeur par défaut
    secret_key: str
    encryption_key: str
    allowed_origins: list[str] = ["http://localhost:5173"]
    uploads_dir: str = "/app/uploads"
    min_trades_for_stats: int = 5   # win rate affiché N/A en dessous de ce seuil

    model_config = SettingsConfigDict(
        env_file=".env.dev",        # surchargé selon APP_ENV dans database.py
        env_file_required=False,    # prod Docker démarre sans fichier .env.*
    )
```

**Règle critique :**
- ❌ Jamais `ALLOWED_ORIGINS = ["http://alphatradingdesk.local"]` dans le code
- ✅ `allowed_origins: list[str] = ["http://localhost:5173"]` comme défaut générique
- La valeur prod est dans `~/apps/.env` sur le Dell

---

## Database — `src/core/database.py`

```
DATABASE_URL dans .env  →  postgresql://user:pass@host:5432/db
                                              ↓
                        _normalise_db_url()  →  postgresql+psycopg://...
                                              ↓
                        create_engine(url, pool_size=5, max_overflow=10)
                                              ↓
                        SessionLocal = sessionmaker(autocommit=False, autoflush=False)
```

**Pourquoi `_normalise_db_url` ?**
- psycopg v3 requiert le préfixe `postgresql+psycopg://`
- On ne veut pas l'écrire dans les `.env` (moins lisible, confusion avec psycopg2)
- La conversion se fait silencieusement à l'initialisation de l'app

---

## `scripts/entrypoint.sh` — Séquence de démarrage

```
Container backend démarre
       │
       ▼
1. Attente Postgres (boucle psycopg.connect toutes les 1s)
   → sans ça : FastAPI crasherait "connection refused"
       │
       ▼
2. Détection état DB (Python inline)
   ├── tables présentes + stamp absent  → alembic stamp head
   │     (restauration manuelle, DB existante mais Alembic ne le sait pas)
   ├── stamp présent + tables absentes  → DELETE FROM alembic_version
   │     (volume wipé mais stamp survit → laisser upgrade recréer tout)
   └── état normal                      → rien, upgrade head gérera
       │
       ▼
3. alembic upgrade head
   → applique les migrations pendantes
   → no-op si déjà à head (idempotent)
       │
       ▼
4. seed_all.py
   → INSERT référentiels (brokers, instruments, etc.)
   → ON CONFLICT DO NOTHING (idempotent)
       │
       ▼
5. (APP_ENV=dev uniquement) seed_test_data si 0 profils
   → app immédiatement utilisable après db-reset
       │
       ▼
6. exec uvicorn src.main:app --host 0.0.0.0 --port 8000 "$@"
   → exec = uvicorn devient PID 1 (pas un sous-processus de bash)
   → "$@" transmet les args : --reload en dev, rien en prod
```

**Pourquoi `exec` et pas juste `uvicorn ...` ?**

```
Sans exec:  bash(PID 1) → fork → uvicorn(PID 2)
Avec exec:  uvicorn(PID 1)   ← remplace bash

Docker envoie SIGTERM au PID 1 à l'arrêt du container.
  Sans exec : bash reçoit SIGTERM, uvicorn tué brutalement → requêtes tronquées, connexions DB non fermées
  Avec exec : uvicorn reçoit SIGTERM, graceful shutdown → drain des requêtes en cours
```

---

## Dockerfile.backend — Layers et Cache

```dockerfile
FROM python:3.11-slim
# -slim = Debian minimal (~130MB). Pas -full (1GB) ni Alpine (incompatibilités C extensions)

WORKDIR /app

# Dépendances système (libpq pour psycopg)
RUN apt-get update && apt-get install -y --no-install-recommends libpq-dev \
    && rm -rf /var/lib/apt/lists/*

# Poetry
RUN pip install --no-cache-dir poetry

# Deps Python — AVANT le code (optimisation cache)
COPY pyproject.toml poetry.lock* ./
RUN poetry config virtualenvs.create false \
    && poetry install --no-root --no-interaction --no-ansi

# Code source — EN DERNIER (invalidé à chaque commit)
COPY src/ ./src/
COPY database/ ./database/
COPY alembic.ini ./
COPY scripts/entrypoint.sh ./
RUN chmod +x ./entrypoint.sh

EXPOSE 8000
ENTRYPOINT ["./entrypoint.sh"]
CMD []
# CMD [] → en prod : uvicorn sans args
# docker-compose.dev.yml command: ["--reload"] → uvicorn --reload en dev
```

**Ordre des layers — pourquoi ça compte :**

```
Layer 1: FROM python:3.11-slim          → change rarement (nouvelle version Python)
Layer 2: apt-get install libpq-dev      → change si on ajoute une lib système
Layer 3: pip install poetry             → change si on change la version Poetry
Layer 4: COPY pyproject.toml poetry.lock → invalide si on ajoute/retire un package
Layer 5: poetry install                 → invalide si layer 4 change
Layer 6: COPY src/ database/ ...        → invalide à chaque changement de code

→ Changer App.tsx : seulement Layer 6 rebuild (~5s)
→ Ajouter httpx dans pyproject.toml : Layers 4+5+6 rebuild (~30s)
→ Pull depuis GHCR (layers en cache) : ~5s
```

**Rebuild requis quand :**
```bash
# En DEV — rebuild l'image backend :
docker compose -f docker-compose.dev.yml build backend
docker compose -f docker-compose.dev.yml up -d backend

# Nécessaire si :
#   - pyproject.toml ou poetry.lock change (nouvelle dépendance)
#   - Dockerfile.backend change
#   - scripts/entrypoint.sh change
# Pas nécessaire : changements dans src/ → bind-mount + uvicorn --reload gère
```

---

## Business Logic — Risk Management

```python
# Calcul de taille de lot (Fixed Fractional)
risk_amount = capital_current * (risk_pct / 100)
lot_size = risk_amount / abs(entry_price - stop_loss)

# Multi-TP : 1 trade → N positions
# Chaque position a : tp_price + lot_pct (% du lot total)
# Ex : TP1 50% @ 1.1050, TP2 30% @ 1.1100, TP3 20% @ 1.1200

# Win rate : affiché N/A si trades_count < min_trades_for_stats (défaut: 5)
# Mise à jour capital : toujours dans la même transaction que la fermeture du trade
```

---

## API Endpoints — Structure

```
GET  /api/health                    → {"status": "ok", "environment": "dev|prod"}

Profiles
  GET/POST    /api/profiles
  GET/PATCH   /api/profiles/{id}

Trades
  GET/POST    /api/trades
  GET/PATCH   /api/trades/{id}
  POST        /api/trades/{id}/close
  POST        /api/trades/{id}/screenshot

Strategies
  GET/POST    /api/strategies
  GET/PATCH   /api/strategies/{id}

Goals
  GET/POST    /api/goals
  GET/PATCH   /api/goals/{id}

Market Analysis
  GET/POST    /api/market-analysis
  GET/PATCH   /api/market-analysis/{id}

Stats
  GET         /api/stats/profile/{id}
  GET         /api/stats/strategies/{profile_id}

Brokers / Instruments
  GET         /api/brokers
  GET         /api/instruments?broker_id=...

API docs auto : http://localhost:8000/docs  (Swagger UI)
               http://localhost:8000/redoc
```

---

## Commandes Backend

```bash
# Lancer en local sans Docker (rare — nécessite Postgres sur localhost:5432)
make backend-dev

# Tests
make backend-test         # rapide, sans coverage
make backend-test-cov     # avec rapport coverage
APP_ENV=test .venv/bin/pytest tests/test_trades.py -v -s   # un fichier spécifique

# Lint + type check
make backend-lint         # ruff check src/ tests/
make backend-typecheck    # mypy src/
make backend-fmt          # ruff check --fix + format (auto-correct)

# CI complet backend (même chose que dans atd-test.yml)
make ci-backend

# Voir les logs backend en dev
docker compose -f docker-compose.dev.yml logs -f backend --tail=50
```

---

## Dépannage Backend

```bash
# Backend ne démarre pas
docker compose -f docker-compose.dev.yml logs backend --tail=50
# Symptômes fréquents :
#   "relation X does not exist" → migration manquante ou stamp cassé → make db-recover
#   "could not connect to server" → Postgres pas prêt → make dev-up (attend le healthcheck)
#   "ModuleNotFoundError" → dépendance manquante → make dev-build

# Erreur mypy en CI
make backend-typecheck
# Corriger les erreurs de type dans src/ avant de pousser

# Test échoue
APP_ENV=test .venv/bin/pytest tests/test_trades.py::TestOpenTrade -v -s --tb=long

# Vérifier que la DB de test existe
docker exec alphatradingdesk-db-1 psql -U atd -d atd_dev \
  -c "CREATE DATABASE atd_test;" 2>/dev/null || true
```
