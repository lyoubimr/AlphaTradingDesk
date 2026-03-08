# scripts/prod/

Production server scripts — versioned in the repo.

**Four scripts are automatically synced to the Dell on every release by CI/CD.**  
`setup-server.sh` is the only exception — it is always copied manually.

## Auto-deployed by CI/CD (after every release)

| Script | Synced by CD? | When to run | How often |
|--------|:---:|------------|-----------|
| `deploy.sh` | ✅ | After every release | Called by CI/CD automatically |
| `backup-db.sh` | ✅ | DB dump | Cron (every 6h + weekly) |
| `setup-cron.sh` | ✅ | After setup, or when crons change | Once, or after cron changes |
| `healthcheck.sh` | ✅ | Ops sanity check | On demand |
| `setup-server.sh` | ❌ manual | Fresh Ubuntu install | Once per server lifetime |

## Why is `setup-server.sh` not auto-deployed?

It provisions the OS (Docker, UFW, Tailscale, `/srv/atd/` directories).  
It runs **before** Docker is even installed — the CI/CD pipeline physically cannot
reach the server to copy files unless `setup-server.sh` has already run.  
It is intentionally a one-time, deliberate manual step.

## How CI/CD syncs scripts

`atd-deploy.yml` uses `appleboy/scp-action` to copy the four scripts to `~/apps/`
on the Dell **before** calling `~/apps/deploy.sh`. This means:

- `deploy.sh` updates itself on the next release (the old version runs, copies the new
  version, the new version executes on the *following* deploy — one release lag for `deploy.sh` itself).
- `backup-db.sh`, `setup-cron.sh`, `healthcheck.sh` are always up-to-date after each release.

## First-time setup (before CI/CD exists)

```bash
# From your Mac, copy all prod scripts at once:
scp scripts/prod/*.sh atd@alphatradingdesk.local:~/apps/
ssh atd@alphatradingdesk.local "chmod +x ~/apps/*.sh"
```

Or copy just the setup script for the very first provision:
```bash
scp scripts/prod/setup-server.sh atd@alphatradingdesk.local:~/setup-server.sh
ssh atd@alphatradingdesk.local "chmod +x ~/setup-server.sh && ~/setup-server.sh"
# setup-server.sh copies the other scripts to ~/apps/ automatically if they exist alongside it
```

## GHCR_OWNER — generic variable

`deploy.sh` requires `GHCR_OWNER` to be set in the environment before it runs.  
CI/CD injects it automatically via `export GHCR_OWNER="${{ github.repository_owner }}"`.  
For manual runs on the Dell:

```bash
export GHCR_OWNER=your-github-org
~/apps/deploy.sh v1.2.3
```

Never hardcode a username in `deploy.sh` — the script must work for any org or fork.
