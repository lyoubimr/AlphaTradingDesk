# scripts/prod/

Production server scripts — versioned in the repo, auto-synced to the Dell on **every push to `main`**.

## Scripts in this directory

| Script | Purpose | When to run |
|--------|---------|-------------|
| `deploy.sh` | Pull new images from GHCR + rolling restart + migrate | Called by CI/CD automatically on every release |
| `backup-db.sh` | `pg_dump` → `/srv/atd/backups/` (rolling 6h + weekly) | Cron (managed by `setup-cron.sh`) |
| `healthcheck.sh` | Ops sanity check — containers, DB, disk, logs | On demand: `~/apps/healthcheck.sh` |
| `setup-cron.sh` | Install all ATD crontab entries (idempotent) | Once after first deploy, or when crons change |
| `setup-ssl.sh` | Generate self-signed TLS cert for LAN HTTPS | Once: `~/apps/setup-ssl.sh` |
| `update-server.sh` | `apt upgrade` + Docker prune + reboot | Cron (1st Sunday/month 04:00, managed by `setup-cron.sh`) |

## How CI/CD syncs scripts

`atd-deploy.yml` — job `sync-scripts` — runs on **every push to `main`** (no version bump required).

It copies the **entire `scripts/prod/` directory** to `~/apps/` on the Dell:

```
scripts/prod/ → ~/apps/   (strip_components: 2)
```

**Any `.sh` file added to `scripts/prod/` is automatically included — no YAML change needed.**

> `setup-server.sh` lives in `scripts/` (not `scripts/prod/`) and is **never auto-synced**.
> It provisions the OS (Docker, UFW, Tailscale, `/srv/atd/` dirs) — a one-time manual step
> that runs before Docker even exists on the server.

## Adding a new prod script

1. Create `scripts/prod/your-script.sh`
2. Commit + push to `develop` → PR → merge to `main`
3. `sync-scripts` job copies it to `~/apps/your-script.sh` automatically
4. **No changes needed in `atd-deploy.yml`**

## First-time setup (before CI/CD is wired)

```bash
# From your Mac — copy all prod scripts at once:
scp scripts/prod/*.sh atd@alphatradingdesk.local:~/apps/
ssh atd@alphatradingdesk.local "chmod +x ~/apps/*.sh"
```

## GHCR_OWNER — generic variable

`deploy.sh` requires `GHCR_OWNER` to be set before it runs.
CI/CD injects it automatically. For manual runs on the Dell:

```bash
export GHCR_OWNER=your-github-org
~/apps/deploy.sh v1.2.3
```
