# ─────────────────────────────────────────────────────────────────
# AlphaTradingDesk — frontend/Dockerfile
# Multi-stage: build (node) → serve (nginx)
# ─────────────────────────────────────────────────────────────────

# ── Stage 1: build ──────────────────────────────────────────────
FROM node:22-alpine AS builder
WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .
RUN npm run build

# ── Stage 2: serve ──────────────────────────────────────────────
FROM nginx:stable-alpine AS runner
COPY --from=builder /app/dist /usr/share/nginx/html

# Nginx config: single-page-app routing + API proxy
COPY nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
