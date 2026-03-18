# ✅ Phase 3 — Post-Implementation Checklist

**Date:** 18 mars 2026
**Version:** 1.0
**Status:** ✅ Phase 3 COMPLETE — deploy prod Dell pending (PR develop → main)

> Ce document couvre les améliorations post-implémentation et la checklist avant déploiement.
> Référence scope : `pre-implement-phase3.md`
> Plan de build : `implement-phase3.md`

---

## 0. ✅ Post-Phase 3 improvements (livrés)

Ces fixes/améliorations ont été développés après l'implémentation initiale et sont **tous committés** sur `develop`.

| # | Amélioration | Commit |
|---|---|---|
| 1 | Fix `risk_settings` PK — `profile_id` comme PK, suppression surrogat `id` | `f323c4a` |
| 2 | Fix échelle confidence : 1–10 côté frontend + label "No data" sur VI absent | `0f39ae4` |
| 3 | Fix RiskSettingsPage — utilisation de `activeProfileId` (au lieu de ID fixe) | `66af270` |
| 4 | Redesign RiskSettingsPage — alignement design system (`surface-*`/`slate-*`) | `a48eb54` |
| 5 | Simulator ignore flag `enabled` — simule toujours tous les critères | `acfffc3` |
| 6 | Suppression auto-rebalance des poids — édition libre + hint contextuel | `4e53b27` |
| 7 | Traduction des libellés weight indicator (FR → EN) | `02a978e` |
| 8 | Alignement couleur TRENDING → indigo-400 (`#818cf8`) dans `MarketVIGauge` | `989db95` |
| 9 | DB fallback pour `market_vi` dans Risk Advisor (était Redis-only → "No data" si cache froid) | `5d0b415` |
| 10 | DB fallback pour `pair_vi` dans Risk Advisor + normalisation casse TF (`1H` → `1h`) | `754b716`, `4b010d0` |
| 11 | `market_vi` toujours en mode `aggregated` (cross-TF) dans Risk Advisor | `8165cca` |
| 12 | Fix emoji TRENDING corrompu (`\ufffd` → `💎`) + couleur gauge dans `MarketVIWidget` | `2609a14` |
| 13 | Suppression badge "Phase 3" dans `RiskSettingsPage` header | `c1a28fc` |

---

## 1. Infrastructure

### Nouveaux fichiers backend

```
src/risk_management/__init__.py
src/risk_management/defaults.py       ← DEFAULT_RISK_CONFIG JSONB seed
src/risk_management/engine.py         ← compute_risk_multiplier()
src/risk_management/models.py         ← RiskSettings SQLAlchemy model
src/risk_management/router.py         ← /api/risk/* routes
src/risk_management/schemas.py        ← Pydantic schemas
src/risk_management/service.py        ← orchestration + DB/cache logic
```

### Nouveaux fichiers frontend

```
frontend/src/lib/riskApi.ts                              ← API client Risk
frontend/src/pages/settings/RiskSettingsPage.tsx         ← Settings UI
frontend/src/components/risk/RiskAdvisorPanel.tsx        ← Panel dans New Trade
frontend/src/components/risk/DashboardRiskAlert.tsx      ← Banner dashboard
```

### Migration Alembic

```
database/migrations/versions/p3001_phase3_risk_management.py
```

Crée :
- Table `risk_settings` (`profile_id PK`, `config JSONB`, `updated_at`)
- Colonne `trades.dynamic_risk_snapshot JSONB`

Auto-run au démarrage via `entrypoint.sh` → `alembic upgrade head`.

### Aucun service Docker nouveau

Phase 3 n'ajoute pas de nouveau service — `docker-compose.prod.yml` sur le Dell reste inchangé.

---

## 2. Variables d'environnement

Aucune nouvelle variable d'environnement ajoutée en Phase 3.

---

## 3. Tests

| Suite | Contenu | Commit |
|-------|---------|--------|
| `tests/test_risk_management.py` | Budget, Advisor, Risk Guard (12 tests d'intégration) | `08062cf` |

Commande : `APP_ENV=test .venv/bin/pytest tests/test_risk_management.py -v`

---

## 4. ✅ Checklist déploiement prod (Dell)

### Avant merge PR

- [x] Tous les steps P3-1 à P3-12 committés sur `develop`
- [x] CI doit passer (ruff + mypy + pytest + eslint + vitest)
- [x] `docker-compose.prod.yml` sur le Dell → pas de modification nécessaire
- [x] `~/apps/.env` sur le Dell → pas de nouvelle variable nécessaire
- [x] Migration `p3001` → auto-run via `alembic upgrade head` dans `entrypoint.sh`

### Après merge PR develop → main

```bash
# Sur le Dell
cd ~/apps
./scripts/prod/deploy.sh
# OU via la cron auto : update-server.sh se déclenche si nouveau tag
```

### Vérification post-deploy

```bash
# Santé globale
./scripts/prod/healthcheck.sh

# Vérifier que la migration s'est bien passée
docker exec alphatradingdesk-backend-1 alembic current
# → doit afficher le head de p3001

# Vérifier les endpoints Phase 3
curl http://alphatradingdesk.local/api/risk/settings/1
curl http://alphatradingdesk.local/api/risk/budget/1
curl "http://alphatradingdesk.local/api/risk/advisor?pair=PF_XBTUSD&timeframe=1h&profile_id=1&base_risk_pct=2.0"
```

---

## 5. Régimes VI — Couleurs canoniques (Phase 3)

Phase 3 a finalisé l'alignement visuel de toutes les couleurs de régime :

| Régime | Hex | Token Tailwind |
|--------|-----|----------------|
| DEAD | `#71717a` | `zinc-500` |
| CALM | `#38bdf8` | `sky-400` |
| NORMAL | `#34d399` | `emerald-400` |
| TRENDING | `#818cf8` | `indigo-400` |
| ACTIVE | `#fb923c` | `orange-400` |
| EXTREME | `#f87171` | `red-400` |

Fichiers utilisant ces couleurs : `MarketVIGauge.tsx`, `MarketVIWidget.tsx`, `RegimeBadge.tsx`.
