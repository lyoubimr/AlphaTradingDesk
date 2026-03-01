# 🐳 Docker Setup - AlphaTradingDesk

**Date:** March 1, 2026  
**Version:** 1.1 (LAN deployment — alphatradingdesk.local via mDNS/Bonjour)

Complete Docker Compose configurations for development and production.

---

## � Related Diagrams

| Diagram | File |
|---------|------|
| System Architecture (Docker services, dev/prod/future, LAN domain, mDNS) | [`../diagrams/01-system-architecture.md`](../diagrams/01-system-architecture.md) |

---

## �📁 File Structure

```
AlphaTradingDesk/
├─ docker-compose.dev.yml     ← Development (includes hot reload)
├─ docker-compose.prod.yml    ← Production (optimized)
├─ Dockerfile.backend          ← Backend image
├─ Dockerfile.frontend         ← Frontend image
├─ .dockerignore              ← Files to exclude
└─ .env.example               ← Environment template
```

---

## 🚀 Quick Start

### Development (localhost)

```bash
# 1. Copy environment template
cp .env.example .env

# 2. Start all services
docker-compose -f docker-compose.dev.yml up -d

# 3. Initialize database
docker-compose -f docker-compose.dev.yml exec backend \
  alembic upgrade head

# 4. Access services
# Frontend:  http://localhost:5173
# Backend:   http://localhost:8000
# API docs:  http://localhost:8000/docs
# DB GUI:    http://localhost:8080  (Adminer)
```

### Production — LAN (alphatradingdesk.local)

```bash
# Production images are built by GitHub Actions and pulled from GHCR.
# The Dell never builds images — it only pulls and runs them.
# See CI_CD.md and SERVER_SETUP.md §9 for the full deploy flow.

# ── One-time setup (on the Dell) ──────────────────────────────────────
# 1. Set static IP + mDNS hostname (see SERVER_SETUP.md §4–5)
# 2. Install Docker + Docker Compose (see SERVER_SETUP.md §6)
# 3. Clone repo: git clone ... ~/apps/AlphaTradingDesk

# ── Deploy (triggered automatically by cd.yml, or manually) ─────────
# See scripts/deploy.sh stub → full design in SERVER_SETUP.md §9.5
#   docker compose -f docker-compose.prod.yml pull
#   docker compose -f docker-compose.prod.yml up -d
#   docker compose -f docker-compose.prod.yml exec backend alembic upgrade head

# ── Access from any device on your LAN ──────────────────────────────
# http://alphatradingdesk.local        ← app
# http://alphatradingdesk.local/api/docs  ← API docs
```

---

## 📝 Environment Variables

### .env.example

```bash
# ========================================
# PHASE 1: Risk Management & Journal
# ========================================

# Database
DATABASE_URL=postgresql://postgres:postgres@postgres:5432/alphatrading

# Redis
REDIS_URL=redis://:password@redis:6379/0

# Backend
SECRET_KEY=your-secret-key-change-in-prod
DEBUG=True  # Set to False in prod
ENVIRONMENT=development  # or production

# CORS (frontend domain)
# DEV:  FRONTEND_URL=http://localhost:5173
# PROD: FRONTEND_URL=http://alphatradingdesk.local
FRONTEND_URL=http://localhost:5173

# Domain (for Caddy reverse proxy — prod only)
# DEV:  leave empty
# PROD: DOMAIN=alphatradingdesk.local
DOMAIN=

# ========================================
# News Intelligence (Feature 4 — Phase 1)
# ========================================
# API keys are stored encrypted in DB per profile — not needed here.
# Only the encryption master key is needed at the app level:
NEWS_ENCRYPTION_KEY=  # 32-byte AES key — generate with: python -c "import secrets; print(secrets.token_hex(32))"

# ========================================
# PHASE 2+: API Keys (Kraken, Binance)
# ========================================

# Kraken (leave empty in Phase 1)
KRAKEN_API_KEY=
KRAKEN_API_SECRET=

# Binance (leave empty in Phase 1)
BINANCE_API_KEY=
BINANCE_API_SECRET=

# ========================================
# PHASE 4: Telegram Notifications
# ========================================

TELEGRAM_BOT_TOKEN=
TELEGRAM_CHAT_ID=

# ========================================
# Logging & Monitoring
# ========================================

LOG_LEVEL=INFO
SENTRY_DSN=  # Optional: error tracking

# ========================================
# Email (optional)
# ========================================

SMTP_SERVER=
SMTP_PORT=
SMTP_USER=
SMTP_PASSWORD=
```

---

## 🐳 docker-compose.dev.yml

> **Phase 1 only:** postgres + backend + frontend + adminer.
> Redis and Celery are **Phase 2+** — not included here.

```yaml
version: '3.9'

services:
  # ========================================
  # PostgreSQL Database
  # ========================================
  postgres:
    image: postgres:15-alpine
    container_name: atd_postgres
    environment:
      POSTGRES_DB: atd_dev
      POSTGRES_USER: atd
      POSTGRES_PASSWORD: dev_password
    ports:
      - "5432:5432"
    volumes:
      - postgres_dev_data:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U atd"]
      interval: 5s
      timeout: 5s
      retries: 5
    networks:
      - atd_network

  # ========================================
  # FastAPI Backend
  # ========================================
  backend:
    build:
      context: .
      dockerfile: Dockerfile.backend
      args:
        ENVIRONMENT: development
    container_name: atd_backend
    command: uvicorn src.main:app --host 0.0.0.0 --port 8000 --reload
    ports:
      - "8000:8000"
    environment:
      - DATABASE_URL=postgresql://atd:dev_password@postgres:5432/atd_dev
      - SECRET_KEY=dev-secret-key-change-in-prod
      - DEBUG=True
      - ENVIRONMENT=development
      - FRONTEND_URL=http://localhost:5173
      - LOG_LEVEL=DEBUG
    volumes:
      - ./src:/app/src  # Hot reload
    depends_on:
      postgres:
        condition: service_healthy
    networks:
      - atd_network
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:8000/health"]
      interval: 10s
      timeout: 5s
      retries: 3

  # ========================================
  # React Frontend (Vite dev server)
  # ========================================
  frontend:
    build:
      context: ./frontend
      dockerfile: Dockerfile
      args:
        ENVIRONMENT: development
    container_name: atd_frontend
    command: npm run dev
    ports:
      - "5173:5173"
    environment:
      - VITE_API_URL=http://localhost:8000
      - VITE_WS_URL=ws://localhost:8000
    volumes:
      - ./frontend/src:/app/src  # Hot reload
      - ./frontend/public:/app/public
    depends_on:
      - backend
    networks:
      - atd_network

  # ========================================
  # Database GUI (Adminer)
  # ========================================
  adminer:
    image: adminer:latest
    container_name: atd_adminer
    ports:
      - "8080:8080"
    depends_on:
      - postgres
    networks:
      - atd_network

networks:
  atd_network:
    driver: bridge

volumes:
  postgres_dev_data:
```

---

## 🐳 docker-compose.prod.yml

> **Phase 1 only:** postgres + backend + frontend + caddy.
> Images are **pulled from GHCR** — never built on the Dell.
> Redis, Celery, Celery Beat → **Phase 2+** (not in this file).

```yaml
version: '3.9'

services:
  # ========================================
  # PostgreSQL Database
  # Phase 2+: switch to timescaledb/timescaledb-docker-ha:pg15-latest
  # ========================================
  postgres:
    image: postgres:15-alpine
    container_name: atd_postgres
    environment:
      POSTGRES_DB: atd_prod
      POSTGRES_USER: atd
      POSTGRES_PASSWORD: ${DB_PASSWORD}
    volumes:
      - /srv/atd/data/postgres:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U atd"]
      interval: 10s
      timeout: 5s
      retries: 5
    networks:
      - atd_network
    restart: unless-stopped

  # ========================================
  # FastAPI Backend (pulled from GHCR)
  # ========================================
  backend:
    image: ghcr.io/${GHCR_ORG}/atd-backend:${IMAGE_TAG:-latest}
    container_name: atd_backend
    command: >
      gunicorn src.main:app
        -w 4
        -k uvicorn.workers.UvicornWorker
        --bind 0.0.0.0:8000
        --access-logfile -
        --error-logfile -
        --log-level info
    environment:
      - DATABASE_URL=postgresql://atd:${DB_PASSWORD}@postgres:5432/atd_prod
      - SECRET_KEY=${SECRET_KEY}
      - DEBUG=False
      - ENVIRONMENT=production
      - FRONTEND_URL=http://alphatradingdesk.local
      - LOG_LEVEL=INFO
      - NEWS_ENCRYPTION_KEY=${NEWS_ENCRYPTION_KEY}
    volumes:
      - /srv/atd/logs/app:/app/logs
    logging:
      driver: "json-file"
      options:
        max-size: "20m"
        max-file: "5"
    depends_on:
      postgres:
        condition: service_healthy
    networks:
      - atd_network
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:8000/health"]
      interval: 30s
      timeout: 10s
      retries: 3
    restart: unless-stopped

  # ========================================
  # React Frontend (pulled from GHCR)
  # ========================================
  frontend:
    image: ghcr.io/${GHCR_ORG}/atd-frontend:${IMAGE_TAG:-latest}
    container_name: atd_frontend
    networks:
      - atd_network
    restart: unless-stopped

  # ========================================
  # Reverse Proxy (Caddy — LAN, HTTP only)
  # ========================================
  caddy:
    image: caddy:latest
    container_name: atd_caddy
    ports:
      - "80:80"
    volumes:
      - ./Caddyfile:/etc/caddy/Caddyfile
      - /srv/atd/data/caddy:/data
    depends_on:
      - backend
      - frontend
    networks:
      - atd_network
    restart: unless-stopped

networks:
  atd_network:
    driver: bridge

volumes:
  # No named volumes — data lives in /srv/atd/ bind mounts (survives container recreation)
```

---

## 🐳 Dockerfile.backend

```dockerfile
# Stage 1: Build
FROM python:3.11-slim as builder

WORKDIR /app

# Install build dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    libpq-dev \
    && rm -rf /var/lib/apt/lists/*

# Install Poetry
RUN pip install --no-cache-dir poetry

# Copy dependency files
COPY pyproject.toml poetry.lock ./

# Install dependencies
ARG ENVIRONMENT=production
RUN if [ "$ENVIRONMENT" = "production" ]; \
    then poetry install --no-dev --no-root; \
    else poetry install --no-root; \
    fi

# Stage 2: Runtime
FROM python:3.11-slim

WORKDIR /app

# Install runtime dependencies only
RUN apt-get update && apt-get install -y --no-install-recommends \
    libpq5 \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Copy virtual environment from builder
COPY --from=builder /root/.cache /root/.cache
COPY --from=builder /app /app

# Copy source code
COPY src ./src
COPY scripts ./scripts
COPY alembic ./alembic
COPY alembic.ini ./

# Create non-root user (security)
RUN useradd -m -u 1000 appuser && chown -R appuser:appuser /app
USER appuser

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
  CMD curl -f http://localhost:8000/health || exit 1

CMD ["uvicorn", "src.main:app", "--host", "0.0.0.0", "--port", "8000"]
```

---

## 🐳 Dockerfile.frontend

```dockerfile
# Stage 1: Build
FROM node:20-alpine as builder

WORKDIR /app

# Copy package files
COPY frontend/package*.json ./

# Install dependencies
RUN npm ci

# Copy source code
COPY frontend/src ./src
COPY frontend/public ./public
COPY frontend/index.html ./
COPY frontend/vite.config.js ./

# Build
ARG ENVIRONMENT=production
ARG VITE_API_URL=https://api.example.com
ARG VITE_WS_URL=wss://api.example.com/ws

RUN VITE_API_URL=$VITE_API_URL VITE_WS_URL=$VITE_WS_URL npm run build

# Stage 2: Serve
FROM nginx:alpine

WORKDIR /usr/share/nginx/html

# Copy Nginx config
COPY frontend/nginx.conf /etc/nginx/nginx.conf

# Copy built app
COPY --from=builder /app/dist ./

# Health check
HEALTHCHECK --interval=30s --timeout=10s --retries=3 \
  CMD wget --quiet --tries=1 --spider http://localhost:80/index.html || exit 1

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
```

---

## 📝 Caddyfile

### PROD — LAN (alphatradingdesk.local, HTTP only)

```
# Caddyfile — LAN production (no TLS needed on local network)

alphatradingdesk.local {
    # SPA routing
    root * /srv/frontend
    file_server
    try_files {path} /index.html

    # API proxy
    reverse_proxy /api/* backend:8000

    # WebSocket
    reverse_proxy /ws/* backend:8000

    # Security headers (LAN — no HSTS needed)
    header {
        X-Content-Type-Options "nosniff"
        X-Frame-Options "SAMEORIGIN"
        X-XSS-Protection "1; mode=block"
        Referrer-Policy "strict-origin-when-cross-origin"
    }

    encode gzip

    log {
        output file /var/log/caddy/access.log
        format json
    }
}
```

### FUTURE — Cloud / Internet domain (HTTPS, Let's Encrypt)

```
# Caddyfile — Cloud production (TLS auto via Let's Encrypt)
# Change: replace alphatradingdesk.local → alphatradingdesk.com
#         add tls directive with your email

alphatradingdesk.com {
    tls {$LETSENCRYPT_EMAIL}

    root * /srv/frontend
    file_server
    try_files {path} /index.html

    reverse_proxy /api/* backend:8000
    reverse_proxy /ws/*  backend:8000

    header {
        Strict-Transport-Security "max-age=31536000; includeSubDomains"
        X-Content-Type-Options "nosniff"
        X-Frame-Options "SAMEORIGIN"
        X-XSS-Protection "1; mode=block"
        Referrer-Policy "strict-origin-when-cross-origin"
    }

    encode gzip
}
```

---

## .dockerignore

```
# Git
.git
.gitignore
.gitattributes

# IDE
.vscode
.idea
*.swp
*.swo
*~

# Python
__pycache__
*.pyc
*.pyo
*.egg-info
.pytest_cache
.coverage
venv/
env/

# Node
node_modules
npm-debug.log

# Environment
.env
.env.local
.env.*.local

# OS
.DS_Store
Thumbs.db

# Project
logs/
tmp/
*.db
.sqlite3
```

---

## 🚀 Common Commands

### Development

```bash
# Start all services
docker-compose -f docker-compose.dev.yml up -d

# View logs
docker-compose -f docker-compose.dev.yml logs -f backend

# Stop services
docker-compose -f docker-compose.dev.yml down

# Rebuild images
docker-compose -f docker-compose.dev.yml build --no-cache

# Run migrations
docker-compose -f docker-compose.dev.yml exec backend alembic upgrade head

# Access database shell
docker-compose -f docker-compose.dev.yml exec postgres psql -U postgres -d alphatrading
```

### Production

```bash
# Start all services
docker-compose -f docker-compose.prod.yml up -d

# View logs
docker-compose -f docker-compose.prod.yml logs -f backend

# Scale workers
docker-compose -f docker-compose.prod.yml up -d --scale celery_worker=3

# Backup database
docker-compose -f docker-compose.prod.yml exec postgres pg_dump -U postgres alphatrading > backup.sql

# Restore database
cat backup.sql | docker-compose -f docker-compose.prod.yml exec -T postgres psql -U postgres alphatrading
```

---

## 🔐 Security Checklist

- [ ] `.env` file NOT in git (use `.env.example`)
- [ ] `SECRET_KEY` changed in production (use strong random value)
- [ ] Database password strong (at least 16 chars, mixed case, numbers, symbols)
- [ ] Redis password set in production
- [ ] HTTPS enabled (Caddy with Let's Encrypt)
- [ ] CORS properly configured (FRONTEND_URL)
- [ ] API keys encrypted in database (Phase 2+)
- [ ] Logs rotated (configure Caddy + Docker)
- [ ] Database backups automated
- [ ] Health checks configured (all services)

---

**Next Document:** → `DATABASE.md` (schema and migrations)
