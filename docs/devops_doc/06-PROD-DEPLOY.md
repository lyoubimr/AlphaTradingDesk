# AlphaTradingDesk — Prod Deploy

**Serveur:** Dell OptiPlex Micro (Ubuntu 24.04 LTS) · IP: 192.168.1.100 · Tailscale: 100.x.x.x

---

## Philosophie Prod

```
Dell ne git clone jamais    → pull uniquement des images depuis GHCR
Dell ne docker build jamais → builds sur les runners GitHub
Données permanentes         → bind mounts sur /srv/atd/ (pas des named volumes)
Secrets                     → ~/apps/.env (jamais dans le repo)
Scripts                     → auto-synchonisés par CD depuis scripts/prod/
```

---

## Arborescence sur le Dell

```
/home/atd/
└── apps/
    ├── docker-compose.prod.yml   → config stack prod (créé manuellement une fois)
    ├── .env                      → secrets runtime (JAMAIS dans le repo)
    ├── deploy.sh                 → ← auto-synchonisé par CD
    ├── backup-db.sh              → ← auto-synchonisé par CD
    ├── setup-cron.sh             → ← auto-synchonisé par CD
    ├── healthcheck.sh            → ← auto-synchonisé par CD
    ├── setup-ssl.sh              → ← auto-synchonisé par CD
    └── update-server.sh          → ← auto-synchonisé par CD

/srv/atd/
├── data/
│   ├── postgres/                 → fichiers PostgreSQL (bind mount container db)
│   └── uploads/                  → fichiers uploadés (bind mount container backend)
├── certs/
│   ├── atd.crt                   → certificat TLS auto-signé (10 ans)
│   └── atd.key                   → clé privée (jamais copier hors du Dell)
├── backups/
│   ├── rolling/                  → pg_dump toutes les 6h (48 fichiers max)
│   └── weekly/                   → pg_dump chaque dimanche 03:00 (13 fichiers max)
└── logs/
    ├── app/                      → logs uvicorn (bind mount backend)
    └── cron/
        ├── backup-db.log
        └── update-server.log
```

---

## Stack Prod — Docker Compose

```yaml
# ~/apps/docker-compose.prod.yml

services:
  db:
    image: postgres:16-alpine
    restart: unless-stopped
    env_file: /srv/atd/.env.db          # POSTGRES_DB + USER + PASSWORD
    volumes:
      - /srv/atd/data/postgres:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U atd -d atd_prod"]
      interval: 10s
      retries: 5
    # Port 5432 NON exposé → DB inaccessible depuis l'extérieur

  backend:
    image: ghcr.io/${GHCR_OWNER}/atd-backend:${IMAGE_TAG:-latest}
    restart: unless-stopped
    env_file: /home/atd/apps/.env
    depends_on:
      db:
        condition: service_healthy
    volumes:
      - /srv/atd/data/uploads:/app/uploads
      - /srv/atd/logs/app:/app/logs
    ports:
      - "8000:8000"

  frontend:
    image: ghcr.io/${GHCR_OWNER}/atd-frontend:${IMAGE_TAG:-latest}
    restart: unless-stopped
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - /srv/atd/certs:/etc/nginx/certs:ro    # cert TLS monté en lecture seule
    depends_on:
      - backend
```

**`restart: unless-stopped`** → containers redémarrent automatiquement après un reboot serveur.
Docker est activé au boot (`systemctl enable docker`) → chaîne complète automatique.

---

## Séquence de Boot après Reboot

```
Serveur reboot
  → systemd démarre Docker (~5s)
  → container db démarre
  → healthcheck db passe (~10–15s)
  → container backend démarre
      → entrypoint.sh : attend DB, alembic upgrade head, seed, uvicorn
  → container frontend démarre (nginx)
  → app live à https://alphatradingdesk.local  (~30–45s après reboot)
  → aucune action manuelle requise
```

---

## Volumes Persistants — Matrice de Survie

```
Scénario                        DB data   Uploads   Action requise
────────────────────────────────────────────────────────────────────
docker compose restart          ✅        ✅        rien
docker compose down             ✅        ✅        rien
docker compose down -v          ✅        ✅        rien (bind mounts!)
docker image rm                 ✅        ✅        re-pull image
Reboot serveur                  ✅        ✅        auto (unless-stopped)
rm -rf /srv/atd/data/postgres   💀        ✅        restore depuis backup
Panne disque Dell               💀        💀        restore depuis Mac rsync
```

---

## SSL / HTTPS

### Pourquoi auto-signé et pas Let's Encrypt ?
Let's Encrypt requiert un challenge HTTP/DNS sur un domaine public.
`.local` = mDNS/RFC 6762 = LAN uniquement → pas de DNS public → Let's Encrypt impossible.
Un cert auto-signé avec SAN est la solution standard pour LAN privé.

### Générer le certificat (une seule fois sur le Dell)

```bash
~/apps/setup-ssl.sh
# Crée : /srv/atd/certs/atd.crt (10 ans, SAN: alphatradingdesk.local + 192.168.1.100)
#         /srv/atd/certs/atd.key

# Puis redémarrer le frontend pour monter le cert
docker compose -f ~/apps/docker-compose.prod.yml up -d frontend
```

### Faire confiance au cert sur macOS

```bash
scp atd@alphatradingdesk.local:/srv/atd/certs/atd.crt ~/Downloads/atd.crt
sudo security add-trusted-cert -d -r trustRoot \
     -k /Library/Keychains/System.keychain ~/Downloads/atd.crt
# Redémarrer browser → https://alphatradingdesk.local sans warning
```

### Vérifications

```bash
# Sans trust (check serveur)
curl -k https://alphatradingdesk.local/api/health

# Après trust sur Mac
curl https://alphatradingdesk.local/api/health   # → {"status": "ok"}

# Détails du cert
openssl x509 -noout -text -in /srv/atd/certs/atd.crt | grep -E "Subject|DNS|IP|Not"
```

### Renouvellement (si nécessaire)

```bash
rm /srv/atd/certs/atd.{crt,key}
~/apps/setup-ssl.sh
docker compose -f ~/apps/docker-compose.prod.yml up -d frontend
# Re-trust sur tous les appareils
```

---

## Backups

### Cron (installé via `~/apps/setup-cron.sh`)

```cron
# Backup rolling toutes les 6h (48 fichiers max = ~12 jours)
0 */6 * * * /home/atd/apps/backup-db.sh rolling >> /srv/atd/logs/cron/backup-db.log 2>&1

# Backup weekly chaque dimanche 03:00 (13 fichiers max = ~3 mois)
0 3 * * 0 /home/atd/apps/backup-db.sh weekly >> /srv/atd/logs/cron/backup-db.log 2>&1
```

### backup-db.sh — Fonctionnement

```bash
docker compose exec -T db pg_dump -U atd atd_prod | gzip > $FILE
# Port 5432 non exposé en prod → exec dans le container = seul accès possible
# Rotation : ls -1t | tail -n +$KEEP | xargs rm
```

### Opérations manuelles

```bash
# Backup immédiat
~/apps/backup-db.sh rolling

# Restore depuis le dernier backup
LATEST=$(ls -1t /srv/atd/backups/rolling/*.sql.gz | head -1)
zcat "$LATEST" | docker compose -f ~/apps/docker-compose.prod.yml exec -T db \
  psql -U atd atd_prod

# Sync backups vers Mac (cron sur Mac, toutes les 4h)
# crontab -e sur Mac :
0 */4 * * * rsync -az --ignore-existing \
  atd@alphatradingdesk.local:/srv/atd/backups/ \
  ~/Backups/AlphaTradingDesk/ \
  >> ~/Library/Logs/atd-backup-sync.log 2>&1
```

---

## Mises à Jour OS et Reboot Mensuel

### Stratégie

| Quoi | Comment | Quand |
|------|---------|-------|
| Updates OS | `apt upgrade` non-interactif | 1er dimanche du mois, 04:00 |
| Docker image prune | images dangling > 72h | même run |
| Reboot | inconditionnel | même run (après backup 03:00) |

Le reboot est **inconditionnel** : garantit que les updates kernel sont appliqués + vérifie que tout redémarre proprement.

### Setup (une fois, après premier déploiement)

```bash
# setup-cron.sh installe/met à jour tout le crontab ATD (idempotent)
~/apps/setup-cron.sh

# Vérifier
crontab -l
```

**Crontab ATD complet :**
```cron
# ATD-BEGIN — managed by setup-cron.sh

0 */6 * * * /home/atd/apps/backup-db.sh rolling >> /srv/atd/logs/cron/backup-db.log 2>&1
0 3 * * 0 /home/atd/apps/backup-db.sh weekly >> /srv/atd/logs/cron/backup-db.log 2>&1
0 1 * * * find /srv/atd/logs/app -name "*.log" -size +100M -exec truncate -s 50M {} \;
0 4 1-7 * 0 /home/atd/apps/update-server.sh >> /srv/atd/logs/cron/update-server.log 2>&1

# ATD-END
```

### Lancer manuellement

```bash
~/apps/update-server.sh
# → apt update + upgrade + docker prune + reboot
# → log dans /srv/atd/logs/cron/update-server.log
```

---

## Déploiement Manuel (sans CI/CD)

```bash
# Déployer une version spécifique
ssh atd
export GHCR_OWNER=<votre-org-github>
~/apps/deploy.sh v1.2.3

# Rollback
~/apps/deploy.sh v1.2.2

# Forcer latest
~/apps/deploy.sh latest
```

---

## Opérations Courantes

```bash
# Connexion rapide
ssh atd   # (alias ~/.ssh/config → alphatradingdesk.local)

# Status global
~/apps/healthcheck.sh

# État des containers
docker compose -f ~/apps/docker-compose.prod.yml ps

# Logs live
docker compose -f ~/apps/docker-compose.prod.yml logs -f
docker compose -f ~/apps/docker-compose.prod.yml logs -f backend --tail=50

# Restart un service
docker compose -f ~/apps/docker-compose.prod.yml restart backend

# CPU/RAM par container
docker stats --no-stream

# Espace disque
df -h /srv/atd

# Vérifier les crons
crontab -l

# Voir les logs de backup
tail -50 /srv/atd/logs/cron/backup-db.log

# Voir les logs de mise à jour
tail -50 /srv/atd/logs/cron/update-server.log

# Vérifier l'API
curl https://alphatradingdesk.local/api/health

# Lancer le reseed de référence (après restauration)
docker compose -f ~/apps/docker-compose.prod.yml exec backend \
  python -m database.migrations.seeds.seed_all
```

---

## Dépannage Prod

```bash
# Container en restart loop
docker compose -f ~/apps/docker-compose.prod.yml logs backend --tail=30
# → "alembic upgrade head" échoue : vérifier que la DB est accessible

# DB ne démarre pas
docker compose -f ~/apps/docker-compose.prod.yml logs db --tail=20
# → vérifier /srv/atd/data/postgres/ (permissions, espace disque)
df -h /srv/atd

# Nginx ne sert pas le frontend
docker compose -f ~/apps/docker-compose.prod.yml logs frontend --tail=20
# → vérifier /srv/atd/certs/atd.{crt,key} existent

# Docker pull échoue (repo privé)
docker login ghcr.io   # vérifier le login
cat ~/.docker/config.json | grep ghcr

# Tailscale déconnecté (deploy échoue)
sudo tailscale status
sudo tailscale up

# Après panne de courant (containers ne redémarrent pas)
sudo systemctl status docker
sudo systemctl start docker
docker compose -f ~/apps/docker-compose.prod.yml up -d
```

---

## Quick Reference — Prod

```
Connexion    ssh atd
App HTTPS    https://alphatradingdesk.local
App HTTP     http://alphatradingdesk.local  → 301 vers HTTPS
App IP       https://192.168.1.100

Compose      ~/apps/docker-compose.prod.yml
Env          ~/apps/.env
Scripts      ~/apps/*.sh

DB data      /srv/atd/data/postgres/
Uploads      /srv/atd/data/uploads/
Certs        /srv/atd/certs/
Backups      /srv/atd/backups/
Logs         /srv/atd/logs/

Deploy       ~/apps/deploy.sh v1.2.3
Rollback     ~/apps/deploy.sh v1.2.2
Backup now   ~/apps/backup-db.sh rolling
Status       ~/apps/healthcheck.sh
Crons        ~/apps/setup-cron.sh  (idempotent)
SSL          ~/apps/setup-ssl.sh   (si cert absent/expiré)
OS update    ~/apps/update-server.sh
```
