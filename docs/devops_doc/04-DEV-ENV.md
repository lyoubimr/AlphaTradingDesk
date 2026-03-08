# AlphaTradingDesk — Dev Environment

**Stack locale:** Docker Compose dev · uvicorn --reload · Vite HMR · Poetry · Makefile

---

## Vue d'ensemble — Stack Dev

```
docker-compose.dev.yml
  ┌──────────────────────────────────────────────────────────────┐
  │  db (postgres:16-alpine)     :5432 (exposé Mac)              │
  │  backend (Dockerfile.backend --reload)  :8000               │
  │  frontend (Dockerfile.dev — Vite HMR)   :5173               │
  │  adminer (adminer:latest)    :8080                           │
  └──────────────────────────────────────────────────────────────┘

Réseau interne Docker :
  backend → db:5432        (nom de service Docker)
  frontend → backend:8000  (Vite proxy)
  adminer → db:5432

Depuis Mac :
  localhost:5173  → React (Vite HMR)
  localhost:8000  → FastAPI (Swagger: /docs)
  localhost:8080  → Adminer (GUI Postgres)
  localhost:5432  → Postgres direct (psql / DBeaver)
```

---

## Démarrage de la Stack

```bash
# Option 1 — logs attachés (recommandé pour voir le démarrage, migrations, seed)
make dev
# ou
docker compose -f docker-compose.dev.yml up

# Option 2 — détaché (travailler sans logs en foreground)
make dev-up
# ou
docker compose -f docker-compose.dev.yml up -d

# Vérifier l'état
docker compose -f docker-compose.dev.yml ps

# À chaque démarrage, le backend automatiquement :
#   1. Attend que Postgres soit healthy
#   2. alembic upgrade head (migrations)
#   3. seed_all.py (données de référence)
#   4. seed_test_data (si 0 profils — dev uniquement)
#   5. uvicorn --reload src.main:app
```

---

## Docker Compose Dev — Expliqué

### Points clés vs prod

| Aspect | Dev | Prod |
|--------|-----|------|
| Image source | `build:` depuis Dockerfiles locaux | `image:` depuis GHCR |
| Code | bind-mount `./src:/app/src` | dans l'image (COPY) |
| Hot-reload | uvicorn `--reload` + Vite HMR | non |
| Port 5432 | exposé Mac (psql local, Alembic local) | NON exposé (sécurité) |
| Port 8000 | exposé Mac | exposé (Nginx proxifie) |
| Adminer | présent (:8080) | absent |
| Volumes DB | named volume Docker | bind mount /srv/atd/data/postgres/ |

### Bind mounts dev — ce qui est monté

```yaml
backend:
  volumes:
    - ./src:/app/src              # → uvicorn voit les changements Python
    - ./database:/app/database    # → migrations éditables sans rebuild
    - ./alembic.ini:/app/alembic.ini
    - ./scripts:/app/scripts      # → entrypoint.sh modifiable
    - ./uploads:/app/uploads      # → uploads persistent en dev

frontend:
  volumes:
    - ./frontend/src:/app/src     # → Vite HMR voit les changements TS/TSX
    - ./frontend/index.html:/app/index.html
    - ./frontend/vite.config.ts:/app/vite.config.ts
    # ⚠️ node_modules PAS bind-mounté → reste dans l'image
    # Si npm install → make dev-rebuild-frontend
```

### depends_on + healthcheck — pourquoi les deux ?

```
depends_on: db: condition: service_healthy
  → le backend ne démarre pas tant que pg_isready ne répond pas
  → sans ça : backend démarrerait et crasherait "connection refused" ~30% du temps

entrypoint.sh a aussi sa propre boucle d'attente : double sécurité
(le healthcheck Docker peut passer avant que Postgres accepte les connexions app)
```

---

## Workflow Dev Quotidien

```bash
# 1. Démarrer
docker compose -f docker-compose.dev.yml up -d

# 2. Coder → modifications auto-détectées
#    Python src/ → uvicorn --reload rechargement automatique
#    TypeScript frontend/src/ → Vite HMR < 50ms

# 3. Ajouter une dépendance Python
#    a. Éditer pyproject.toml ou :
poetry add <package>
#    b. Rebuild l'image backend
docker compose -f docker-compose.dev.yml build backend
docker compose -f docker-compose.dev.yml up -d backend

# 4. Ajouter une dépendance npm
cd frontend && npm install <package>
make dev-rebuild-frontend

# 5. Modifier un modèle SQLAlchemy → migration
make db-revision msg="add screenshot_url to performance_snapshots"
# Lire le fichier généré dans database/migrations/versions/
make db-upgrade

# 6. CI local avant de pousser
make ci
# = ruff + mypy + pytest + eslint + tsc + vitest

# 7. Commit
git add -A
git commit -m "feat(trades): add screenshot upload"
git push origin develop
```

---

## Makefile — Référence

### Pourquoi un Makefile ?

```
Sans Makefile : retaper des commandes longues à chaque fois
  APP_ENV=test .venv/bin/python -m pytest tests/ -v --cov=src

Avec Makefile :
  make backend-test-cov

Rôles du Makefile :
  1. Raccourcis pour les opérations complexes
  2. Documentation exécutable (make help)
  3. Cohérence CI/dev (même commande que dans atd-test.yml)
  4. Abstraction (changer .venv/bin/ → modifier le Makefile une fois)
```

### Variables Makefile

```makefile
COMPOSE  := docker compose -f docker-compose.dev.yml
PYTHON   := .venv/bin/python          # Python venv projet-local (pas besoin d'activer)
ALEMBIC  := APP_ENV=dev .venv/bin/alembic  # force .env.dev avant chaque commande Alembic
PYTEST   := .venv/bin/pytest
RUFF     := .venv/bin/ruff
MYPY     := .venv/bin/mypy
```

### Toutes les cibles

#### Docker Compose

| Commande | Utilisation |
|---------|-------------|
| `make dev` | Démarrage avec logs (debug migration/seed) |
| `make dev-up` | Démarrage silencieux (détaché) |
| `make dev-build` | Rebuild toutes les images (après changement Dockerfile ou deps) |
| `make dev-rebuild-frontend` | Rebuild image frontend seulement (après npm install) |
| `make dev-down` | Arrêt + suppression containers (données préservées) |
| `make dev-logs` | Voir les logs sans redémarrer |

#### Backend

| Commande | Utilisation |
|---------|-------------|
| `make backend-test` | Tests rapides (pas de coverage) |
| `make backend-test-cov` | Tests + rapport coverage |
| `make backend-lint` | ruff check src/ tests/ |
| `make backend-fmt` | ruff --fix + format (auto-correct) |
| `make backend-typecheck` | mypy src/ |
| `make ci-backend` | lint + typecheck + tests (= CI) |

#### Base de données

| Commande | Utilisation | Danger |
|---------|-------------|--------|
| `make db-upgrade` | Applique migrations pendantes | — |
| `make db-downgrade` | Rollback -1 | — |
| `make db-current` | Révision courante | lecture seule |
| `make db-history` | Historique migrations | lecture seule |
| `make db-revision msg="..."` | Génère migration | lire avant d'appliquer |
| `make db-seed` | Seed référentiels | idempotent |
| `make db-seed-test` | Seed profils + trades | idempotent |
| `make db-seed-ma` | Seed Market Analysis | idempotent |
| `make db-reset` | Reset DB (DESTRUCTIF) | ⚠️ |
| `make db-refresh` | Reset + migrate + seed | ⚠️ |
| `make db-recover` | Répare stamp cassé | non-destructif |
| `make db-recover-full` | Répare + reseed | non-destructif |

#### CI / Frontend

| Commande | Utilisation |
|---------|-------------|
| `make ci` | CI complet (backend + frontend) |
| `make ci-frontend` | eslint + tsc + vitest |

---

## Poetry — Gestion des Dépendances

```bash
# Installer le projet (crée .venv/ à la racine)
poetry install

# Ajouter une dépendance
poetry add fastapi
poetry add --group dev pytest-cov  # dev-only

# Mettre à jour une dépendance
poetry update <package>

# Voir les dépendances installées
poetry show

# Activer le venv (optionnel — Makefile utilise .venv/bin/python directement)
poetry shell

# Pourquoi poetry.toml à la racine ?
# → virtualenvs.in-project = true → venv créé dans .venv/ (projet-local)
# → pas dans ~/.cache/pypoetry/... (plus prévisible)
```

---

## URLs et Credentials Dev

```
Frontend (React Vite HMR) : http://localhost:5173
Backend API               : http://localhost:8000
Swagger UI                : http://localhost:8000/docs
ReDoc                     : http://localhost:8000/redoc
Adminer (DB GUI)          : http://localhost:8080
  Serveur: db | User: atd | MDP: dev_password | DB: atd_dev

Postgres direct (Mac)     : postgresql://atd:dev_password@localhost:5432/atd_dev
```

---

## Dépannage Environnement Dev

```bash
# Stack ne démarre pas
docker compose -f docker-compose.dev.yml logs
docker compose -f docker-compose.dev.yml ps

# Backend crashe au démarrage
docker compose -f docker-compose.dev.yml logs backend --tail=50
# → "relation X does not exist" : make db-recover
# → "connection refused" : Postgres pas prêt → docker compose restart backend
# → "ModuleNotFoundError" : make dev-build

# HMR frontend ne fonctionne plus
docker compose -f docker-compose.dev.yml restart frontend
touch frontend/src/App.tsx   # forcer la détection

# Port déjà utilisé
lsof -ti:5173 | xargs kill -9
lsof -ti:8000 | xargs kill -9

# Problème de permissions sur les uploads
docker compose -f docker-compose.dev.yml exec backend mkdir -p /app/uploads
docker compose -f docker-compose.dev.yml exec backend chmod 755 /app/uploads

# Reset complet si tout est cassé
make dev-down
docker volume prune          # ⚠️ supprime les données dev
make dev-up                  # recrée tout + migrations + seed automatiques
```
