# AlphaTradingDesk — DevOps Documentation

**Phase:** 1 · **Version:** 1.0.0 · **Maintenu par:** Mohamed  
**En français · Orienté ingénieur DevOps · Exhaustif mais concis**

> Cette doc est la **référence opérationnelle** du projet.
> Elle décrit l'état réel (v1.0.0 en prod) — pas les specs initiales.

---

## Fichiers

| Fichier | Contenu |
|---------|---------|
| [`00-OVERVIEW.md`](00-OVERVIEW.md) | Architecture globale, schéma complet, stack tech, structure projet, flux de données, convention de commits |
| [`01-DATABASE.md`](01-DATABASE.md) | PostgreSQL, schéma Phase 1, SQLAlchemy, Alembic (workflow complet), seeds, connexion, diagnostic, recovery |
| [`02-BACKEND.md`](02-BACKEND.md) | FastAPI, structure src/, config/Settings, entrypoint.sh, Dockerfile.backend, business logic, endpoints |
| [`03-FRONTEND.md`](03-FRONTEND.md) | React/Vite, structure src/, Nginx (SPA + proxy), Dockerfile multi-stage, themes, commandes |
| [`04-DEV-ENV.md`](04-DEV-ENV.md) | Stack dev locale, Docker Compose dev, Makefile (toutes les cibles), workflow quotidien, Poetry |
| [`05-CICD.md`](05-CICD.md) | GitHub Actions (CI + CD détaillés), GHCR, semver, Tailscale, GitHub Secrets, rollback |
| [`06-PROD-DEPLOY.md`](06-PROD-DEPLOY.md) | Dell, arborescence prod, Docker Compose prod, SSL, backups, crons, update OS, ops courantes |

---

## Démarrage rapide

```bash
# Dev
docker compose -f docker-compose.dev.yml up -d
# → http://localhost:5173 (React) · http://localhost:8000/docs (API) · http://localhost:8080 (Adminer)

# Tests
make ci   # lint + typecheck + pytest + eslint + vitest

# Migration DB
make db-revision msg="..."  # générer
make db-upgrade              # appliquer

# Prod (depuis Mac)
ssh atd
~/apps/healthcheck.sh
```

---

## Structure `docs/`

```
docs/
├── devops_doc/         ← référence opérationnelle (ce dossier)
│   ├── README.md
│   ├── 00-OVERVIEW.md
│   ├── 01-DATABASE.md
│   ├── 02-BACKEND.md
│   ├── 03-FRONTEND.md
│   ├── 04-DEV-ENV.md
│   ├── 05-CICD.md
│   └── 06-PROD-DEPLOY.md
│
├── deployment/phases/phase1/
│   └── SERVER_SETUP.md  ← guide d'installation Dell complet (étape par étape)
│
└── architecture/        ← specs de conception initiale (référence historique)
    ├── tech/DATABASE.md        → schéma SQL détaillé (champs complets)
    └── ...
```
