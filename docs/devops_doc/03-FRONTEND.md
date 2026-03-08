# AlphaTradingDesk — Frontend

**Stack:** React 19 · Vite 8 · TypeScript · Tailwind CSS v4 · React Router v6 · Nginx

---

## Architecture Frontend

```
┌────────────────────────────────────────────────────────────────────┐
│  DEV (Dockerfile.dev)            PROD (Dockerfile multi-stage)     │
│                                                                     │
│  node:22-alpine                  Stage 1 (builder)                 │
│  + Vite dev server               node:22-alpine                    │
│  + HMR                           → npm ci                          │
│  bind-mounts src/                → npm run build → dist/           │
│  :5173                                                              │
│                                  Stage 2 (runner)                  │
│                                  nginx:stable-alpine (~25MB)       │
│                                  ← COPY dist/ from builder         │
│                                  ← COPY nginx.conf                 │
│                                  :80 (HTTP) + :443 (HTTPS)         │
└────────────────────────────────────────────────────────────────────┘
```

---

## Structure `frontend/src/`

```
frontend/src/
├── main.tsx              → entrée app : <ThemeProvider><ProfileProvider><Router>
├── App.tsx               → routes React Router v6 (layout + pages)
│
├── context/
│   ├── ThemeContext.tsx   → theme courant (localStorage atd_theme)
│   │   → applique data-theme="<id>" sur <html> → CSS variables Tailwind
│   └── ProfileContext.tsx → profil actif (localStorage atd_active_profile)
│       → chargé une fois, partagé dans toute l'app
│
├── lib/
│   └── api.ts            → TOUS les appels fetch vers le backend
│       → BASE_URL = VITE_API_URL ?? "http://localhost:8000"
│       → export const tradesApi, goalsApi, strategiesApi, etc.
│
├── types/
│   └── api.ts            → types TypeScript pour tous les objets backend
│       → Trade, Profile, Position, Strategy, Goal, MarketAnalysis...
│       → miroir des schemas Pydantic backend
│
├── pages/
│   ├── dashboard/        → DashboardPage (widgets capital, trades, objectifs)
│   ├── trades/           → TradesPage, NewTradePage, TradeDetailPage
│   ├── goals/            → GoalsPage
│   ├── market-analysis/  → MarketAnalysisPage, NewAnalysisPage
│   └── settings/         → SettingsPage, ProfilesPage, StrategiesSettingsPage
│
└── components/           → composants réutilisables
    ├── badges/           → status badge, risk badge, etc.
    ├── modals/           → confirm modal, form modal
    └── ...
```

---

## Vite — Pourquoi et Comment

**Pourquoi Vite et pas Webpack / Create React App ?**
- Webpack : bundle tout → rebuild complet à chaque changement → lent en dev
- Vite : ESM natif → **seul le module modifié est re-servi** → HMR < 50ms
- En prod : `vite build` → bundle + minification via Rollup (dans Vite)

**Proxy en dev (`vite.config.ts`) :**
```typescript
server: {
  proxy: {
    '/api': {
      target: process.env.VITE_API_TARGET ?? 'http://localhost:8000',
      changeOrigin: true
    }
  },
  watch: {
    usePolling: true  // fix macOS Docker : inotify ne fonctionne pas sur bind mounts
  }
}
```
→ Toutes les requêtes `/api/*` du browser sont proxifiées vers le backend.
→ En prod, Nginx fait exactement la même chose.
→ **Pas de CORS** dans les deux cas (même origine du point de vue du browser).

---

## Nginx — Configuration Prod

```nginx
# frontend/nginx.conf

# Bloc HTTP → redirect HTTPS
server {
    listen 80;
    return 301 https://$host$request_uri;
}

# Bloc HTTPS
server {
    listen 443 ssl;
    ssl_certificate     /etc/nginx/certs/atd.crt;
    ssl_certificate_key /etc/nginx/certs/atd.key;
    ssl_protocols       TLSv1.2 TLSv1.3;

    root /usr/share/nginx/html;
    index index.html;

    # SPA routing — ESSENTIEL pour React Router
    location / {
        try_files $uri $uri/ /index.html;
        # Sans ça : refresh sur /trades/123 → 404 Nginx
        # Avec ça : Nginx sert index.html → React Router gère /trades/123
    }

    # API proxy → backend container
    location /api/ {
        proxy_pass         http://backend:8000/;
        proxy_set_header   Host $host;
        proxy_set_header   X-Real-IP $remote_addr;
        proxy_set_header   X-Forwarded-Proto $scheme;
    }
}
```

**Deux rôles de Nginx :**
1. **Serveur statique** : sert les fichiers `dist/` (HTML, JS, CSS, assets)
2. **Reverse proxy** : proxifie `/api/*` vers `http://backend:8000/`
   → Le browser ne connaît jamais l'IP ou le port du backend
   → Même domaine → pas de CORS

---

## Dockerfile multi-stage — Détail

```dockerfile
# Stage 1: BUILD
FROM node:22-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci                    # déterministe, depuis package-lock.json
COPY . .
RUN npm run build             # → dist/ (HTML + JS bundlé + CSS)

# Stage 2: SERVE
FROM nginx:stable-alpine
COPY --from=builder /app/dist /usr/share/nginx/html   # seulement dist/
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80 443
CMD ["nginx", "-g", "daemon off;"]
# daemon off; = Nginx en foreground (pas de systemd dans Docker)
```

**Pourquoi multi-stage ?**
```
Image monolithique (naïf) : node:22-alpine + node_modules + sources TypeScript → ~800MB
Image multi-stage         : nginx:stable-alpine + dist/ compilé             → ~25MB
```

**Dockerfile.dev (dev uniquement) :**
```dockerfile
FROM node:22-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
CMD ["npm", "run", "dev", "--", "--host", "0.0.0.0"]
# --host 0.0.0.0 : écoute sur toutes interfaces → port 5173 accessible depuis Mac
```

---

## Themes CSS

```
Définis dans : frontend/src/index.css
Mécanisme    : CSS variables sur [data-theme="<id>"]
Appliqués    : document.documentElement.setAttribute('data-theme', themeId)
Persistance  : localStorage['atd_theme']

Themes disponibles : indigo (défaut) | emerald | amber | rose | cyan
Picker             : Settings → Appearance
```

---

## Commandes Frontend

```bash
# Depuis le Mac — dans frontend/
cd frontend

# Installer les dépendances (sans Docker)
npm ci

# Lancer en dev standalone (sans Docker)
npm run dev

# Build prod
npm run build

# Type check
npx tsc --noEmit

# Lint
npm run lint

# Tests (vitest)
npm run test

# Via Makefile (depuis la racine)
make ci-frontend    # eslint + tsc + vitest
make dev-rebuild-frontend  # rebuild image Docker frontend (après npm install)

# Rebuild après npm install (node_modules est dans l'image, pas le bind mount)
make dev-rebuild-frontend
# ou
docker compose -f docker-compose.dev.yml build frontend
docker compose -f docker-compose.dev.yml up -d frontend
```

---

## Dépannage Frontend

```bash
# HMR ne fonctionne plus (modifications non détectées)
docker compose -f docker-compose.dev.yml restart frontend
# ou forcer un touch
touch frontend/src/App.tsx

# Si toujours rien → rebuild
make dev-rebuild-frontend

# Erreur TypeScript en CI
cd frontend && npx tsc --noEmit
# Corriger les erreurs avant de pousser

# ESLint en CI
cd frontend && npm run lint

# Tests vitest
cd frontend && npm run test

# Vérifier que le proxy fonctionne (dev)
curl http://localhost:5173/api/health
# Doit retourner {"status": "ok"}

# Logs container frontend
docker compose -f docker-compose.dev.yml logs -f frontend --tail=30
```
