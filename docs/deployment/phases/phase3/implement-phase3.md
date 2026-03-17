# 🛠️ Phase 3 — Implementation Plan

**Date:** 17 mars 2026
**Version:** 1.0
**Status:** 📝 Draft — prêt pour démarrage

> Ce document décrit **quoi construire, dans quel ordre**.
> Chaque step est un incrément testable — rien n'est laissé en suspend.
> Référence scope : `pre-implement-phase3.md`

---

## 🗺️ Roadmap Phase 3

| Step | Quoi | Statut |
|------|------|--------|
| **P3-1** | Alembic migration — `risk_settings` table + colonne `dynamic_risk_snapshot` sur `trades` | ⏳ |
| **P3-2** | Dynamic Risk Engine — `compute_risk_multiplier()` service | ⏳ |
| **P3-3** | Live Pair VI endpoint — fetch Kraken en temps réel | ⏳ |
| **P3-4** | Risk Settings CRUD API — GET/PUT par profile | ⏳ |
| **P3-5** | Risk Budget API — budget concurrent restant | ⏳ |
| **P3-6** | Risk Advisor API — endpoint de calcul complet | ⏳ |
| **P3-7** | Risk Guard — blocage dans `open_trade` + override `force` | ⏳ |
| **P3-8** | Dashboard Alert — endpoint + données budget pour banner | ⏳ |
| **P3-9** | Frontend — Risk Advisor panel dans le formulaire New Trade | ⏳ |
| **P3-10** | Frontend — Risk Settings page (criteria + weights + factors) | ⏳ |
| **P3-11** | Frontend — Dashboard alert banner (Risk Guard) | ⏳ |
| **P3-12** | Tests unitaires + QA pass | ⏳ |
| **P3-13** | Deploy prod Dell | ⏳ |

---

## Step P3-1 — Alembic migration

**Quoi :**
- Créer la table `risk_settings` (une ligne par profil, config JSONB)
- Ajouter la colonne `dynamic_risk_snapshot JSONB` sur la table `trades`
  (stocke le détail du calcul à l'ouverture — auditabilité complète)

**Fichiers touchés :**
```
database/migrations/versions/XXXX_phase3_risk_settings.py  ← NEW
```

**Schéma :**
```sql
CREATE TABLE IF NOT EXISTS risk_settings (
    id         BIGSERIAL PRIMARY KEY,
    profile_id BIGINT NOT NULL UNIQUE REFERENCES profiles(id) ON DELETE CASCADE,
    config     JSONB  NOT NULL DEFAULT '{}',
    updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_risk_settings_profile ON risk_settings(profile_id);

ALTER TABLE trades
    ADD COLUMN IF NOT EXISTS dynamic_risk_snapshot JSONB;
```

**Test :** `make migrate` → table présente, colonne ajoutée. `make migrate-down` + redo = idempotent.

---

## Step P3-2 — Dynamic Risk Engine

**Quoi :**
Créer `src/risk_management/engine.py` — cœur du système.

**Fichiers touchés :**
```
src/risk_management/__init__.py         ← NEW (module init)
src/risk_management/engine.py           ← NEW
src/risk_management/schemas.py          ← NEW (RiskAdvisorRequest/Result)
src/risk_management/defaults.py         ← NEW (DEFAULT_RISK_CONFIG JSONB)
```

**Interface principale :**
```python
# src/risk_management/engine.py

def compute_risk_multiplier(
    config: dict,                        # risk_settings.config pour ce profile
    market_vi_regime: str | None,        # ex: "TRENDING" — depuis Redis cache
    pair_vi_regime:   str | None,        # ex: "ACTIVE"   — fetché live
    ma_direction_match: str | None,      # "aligned" | "neutral" | "opposed"
    strategy_wr: float | None,           # 0.0–1.0, None si insuffisant
    strategy_has_stats: bool,            # False → WR neutre (1.0)
    confidence_score: int | None,        # 0–100, None → neutre
) -> RiskMultiplierResult:
    """
    Retourne le breakdown complet + le multiplier final.
    Ne lève jamais d'exception — retourne des facteurs neutres (1.0) en cas de données manquantes.
    """
```

**Structure de retour `RiskMultiplierResult` :**
```python
@dataclass
class CriterionDetail:
    name: str
    enabled: bool
    value_label: str   # "TRENDING", "65%", "80/100", etc.
    factor: float
    weight: float
    contribution: float   # factor * weight / total_weight

@dataclass
class RiskMultiplierResult:
    multiplier: float           # valeur finale (peut > 1.0)
    criteria: list[CriterionDetail]
    base_risk_pct: float        # profile.risk_percentage_default
    adjusted_risk_pct: float    # base_risk_pct * multiplier
    adjusted_risk_amount: float # adjusted_risk_pct / 100 * capital
    budget_remaining_pct: float # max_concurrent - current_used
    budget_blocking: bool       # True si adjusted > budget restant
    suggested_risk_pct: float   # min(adjusted, budget) si budget_blocking
```

**Logique de normalisation des weights :**
```python
# Les weights sont normalisés au runtime — pas validés à la configuration.
# Permet d'activer/désactiver des critères sans recalculer les weights manuellement.
enabled_criteria = [c for c in criteria if c["enabled"]]
total_weight = sum(c["weight"] for c in enabled_criteria)
# Division par total_weight → normalisation automatique
```

**Test :** `pytest tests/risk_management/test_engine.py` — 8 cas couverts minimum :
- All criteria enabled, all favorable → multiplier ≥ 1.40  (TRENDING+aligned+conf 100)
- All criteria enabled, all unfavorable → multiplier ≤ 0.55
- Strategy WR neutre (insufficient trades) → WR criterion = 1.0
- Confidence None → confidence criterion = 1.0
- MA direction aligned → factor 1.3
- Disabled criterion not included in calculation
- Budget blocking → `budget_blocking=True`, `suggested_risk_pct < effective_risk_pct`
- `global_multiplier_max` respected

---

## Step P3-3 — Live Pair VI endpoint

**Quoi :**
Endpoint `GET /api/risk/pair-vi?pair=PF_BTCUSD&timeframe=1h` — retourne le VI + regime
du pair Kraken en temps réel (utilisé par le formulaire trade au changement de pair).

**Stratégie :**
1. Chercher d'abord dans Redis (`cache_pair_vi`) — si cache valide (< 30min) → retourner
2. Sinon → fetch Kraken live (`KrakenClient.fetch_ohlcv`) + `compute_vi_score()` → cacher + retourner

**Fichiers touchés :**
```
src/risk_management/router.py      ← NEW (router Phase 3, prefix /api/risk)
src/risk_management/service.py     ← NEW (get_live_pair_vi + helpers)
```

**Response :**
```json
{
  "pair": "PF_BTCUSD",
  "timeframe": "1h",
  "vi_score": 0.612,
  "regime": "TRENDING",
  "ema_score": 0.78,
  "ema_signal": "above_all",
  "source": "cache",        // "cache" | "live"
  "computed_at": "2026-03-17T14:30:00Z"
}
```

**Test :** Mock `KrakenClient` → retourne des candles fixes → vérifie regime + cache hit.

**Note prod :** le fetch live peut prendre 1-3s sur Kraken. Le frontend affiche un spinner.

---

## Step P3-4 — Risk Settings CRUD API

**Quoi :**
```
GET  /api/risk/settings/{profile_id}   → retourne config actuelle (créée auto si absente)
PUT  /api/risk/settings/{profile_id}   → merge-patch config (JSONB merge, pas de replace total)
```

**Fichiers touchés :**
```
src/risk_management/router.py     ← ajouter routes
src/risk_management/service.py    ← get_risk_settings / upsert_risk_settings
src/risk_management/defaults.py   ← DEFAULT_RISK_CONFIG
src/risk_management/models.py     ← NEW SQLAlchemy model RiskSettings
```

**Défaut auto-créé :**
Si aucune ligne n'existe pour `profile_id` → une ligne avec `DEFAULT_RISK_CONFIG` est insérée
et retournée. Ce comportement est transparent pour le frontend (toujours un GET réussi).

**Test :** GET profil sans settings → 200 + defaults. PUT partial update → seuls les champs
fournis sont mis à jour (deep merge sur le JSONB).

---

## Step P3-5 — Risk Budget API

**Quoi :**
```
GET /api/risk/budget/{profile_id}
```

**Response :**
```json
{
  "profile_id": 1,
  "capital_current": 10000.0,
  "risk_pct_default": 2.0,
  "max_concurrent_risk_pct": 6.0,
  "concurrent_risk_used_pct": 3.8,
  "budget_remaining_pct": 2.2,
  "budget_remaining_amount": 220.0,
  "open_trades_count": 3,
  "pending_trades_count": 1,
  "alert_risk_saturated": false    // true si used >= max AND pending > 0
}
```

**Calcul `concurrent_risk_used_pct` :**
```sql
SELECT COALESCE(SUM(risk_amount), 0) / capital_current * 100
FROM trades
JOIN profiles ON profiles.id = trades.profile_id
WHERE trades.profile_id = :id
  AND trades.status IN ('open', 'partial', 'pending')
```

**Fichiers touchés :**
```
src/risk_management/router.py
src/risk_management/service.py
```

**Test :** 3 trades open + 1 pending → risk_used correct. Budget alert flag correct.

---

## Step P3-6 — Risk Advisor API (calcul complet)

**Quoi :**
```
GET /api/risk/advisor
  ?profile_id=1
  &pair=PF_BTCUSD
  &timeframe=1h
  &direction=long
  &strategy_id=3          (optionnel)
  &confidence=80          (optionnel, 0–100)
  &ma_session_id=42       (optionnel — pour récupérer la direction analysée)
```

Ce endpoint orchestre tout :
1. Charger `risk_settings` du profile
2. Charger le budget concurrent (`P3-5` logique)
3. Résoudre `market_vi_regime` depuis Redis
4. Résoudre `pair_vi_regime` depuis cache/live (`P3-3` logique)
5. Résoudre `ma_direction_match` depuis `market_analysis_sessions` si `ma_session_id` fourni
6. Résoudre `strategy_wr` + `strategy_has_stats` depuis `strategies` si `strategy_id` fourni
7. Appeler `compute_risk_multiplier()` (`P3-2`)
8. Retourner le résultat complet

**Response :**
```json
{
  "base_risk_pct": 2.0,
  "adjusted_risk_pct": 2.39,
  "adjusted_risk_amount": 239.0,
  "multiplier": 1.195,
  "criteria": [
    {
      "name": "market_vi",
      "enabled": true,
      "value_label": "TRENDING",
      "factor": 1.50,
      "weight": 0.20,
      "contribution": 0.300
    },
    {
      "name": "pair_vi",
      "enabled": true,
      "value_label": "ACTIVE",
      "factor": 1.20,
      "weight": 0.25,
      "contribution": 0.300
    },
    {
      "name": "ma_direction",
      "enabled": true,
      "value_label": "Aligned ↑",
      "factor": 1.30,
      "weight": 0.20,
      "contribution": 0.26
    },
    {
      "name": "strategy_wr",
      "enabled": true,
      "value_label": "65% (32 trades)",
      "factor": 1.15,
      "weight": 0.20,
      "contribution": 0.23
    },
    {
      "name": "confidence",
      "enabled": true,
      "value_label": "80/100",
      "factor": 1.30,
      "weight": 0.15,
      "contribution": 0.195
    }
  ],
  "budget_remaining_pct": 2.61,
  "budget_remaining_amount": 261.0,
  "budget_blocking": false,
  "suggested_risk_pct": 2.57
}
```

**Fichiers touchés :**
```
src/risk_management/router.py
src/risk_management/service.py    ← orchestrate_risk_advisor()
```

---

## Step P3-7 — Risk Guard dans open_trade

**Quoi :**
Enrichir `trades/service.py::open_trade()` :
1. Calculer `concurrent_risk_used` (trades open+partial+pending)
2. Résoudre le **risque effectif** = `risk_pct_override` si fourni, sinon `risk_percentage_default`
   → la garde s'applique quel que soit le chemin (base brut, ajusté, ou override manuel)
3. Si `effective_risk_amount > budget_remaining` ET `force != True` → `HTTP 422` avec message clair
4. Si `force=True` ET `risk_guard.force_allowed=True` → log warning + passer outre
   Si `risk_guard.force_allowed=False` → `HTTP 422` même avec `force=True` (mode strict)
5. Persister `dynamic_risk_snapshot` dans `trade.dynamic_risk_snapshot` (JSONB)

**Schema enrichi `TradeOpen` :**
```python
class TradeOpen(BaseModel):
    # ... champs existants ...
    force: bool = False                       # override du blocage budget
    dynamic_risk_snapshot: dict | None = None # breakdown Risk Advisor au moment de l'ouverture
```

**Response d'erreur blocage :**
```json
{
  "detail": "Insufficient risk budget. Remaining: 0.8%, requested: 2.57%. Use force=true to override.",
  "code": "RISK_BUDGET_EXCEEDED",
  "budget_remaining_pct": 0.8,
  "effective_risk_pct": 2.57,
  "force_allowed": true
}
```
> `force_allowed: false` dans la réponse indique que même `force=True` sera rejeté
> (profile a configuré `risk_guard.force_allowed = false` — mode discipline stricte).

**Fichiers touchés :**
```
src/trades/service.py    ← enrichir open_trade()
src/trades/schemas.py    ← ajouter force + dynamic_risk_snapshot
src/trades/router.py     ← (pas de changement si service gère)
```

**Test :** trade qui dépasse le budget → 422. Même trade avec `force=True` → 201.

---

## Step P3-8 — Dashboard Alert data

**Quoi :**
Le budget endpoint (`P3-5`) expose déjà `alert_risk_saturated`. Il suffit de :
- L'appeler depuis le frontend Dashboard au chargement
- L'exposer dans le store React (context global)

Ce step est largement frontend — pas de nouveau endpoint backend.

Optionnel : enrichir `GET /api/profiles/{id}` pour retourner `concurrent_risk_summary`
embedded (évite un appel séparé côté dashboard).

---

## Step P3-9 — Frontend : Risk Advisor panel (New Trade)

**Quoi :**
Composant `<RiskAdvisorPanel>` intégré dans le formulaire New Trade.

**Fichiers touchés :**
```
frontend/src/components/risk/RiskAdvisorPanel.tsx     ← NEW
frontend/src/pages/trades/NewTradePage.tsx            ← ou TradeFormModal (selon existant)
frontend/src/lib/api/risk.ts                          ← NEW (appels API risk)
frontend/src/types/risk.ts                            ← NEW (types RiskAdvisorResult, etc.)
```

**Comportement :**
- Déclenché automatiquement quand `pair` + `timeframe` + `direction` sont renseignés
- Spinner pendant le fetch (surtout si pair VI est fetché live)
- Affiche le tableau breakdown + multiplier + risk ajusté
- 3 boutons : Accept · Override (input libre) · Reset to base
- La valeur retenue alimente `risk_pct_override` dans le payload `TradeOpen`
- `dynamic_risk_snapshot` est inclus dans le payload (les critères du moment)

**UX :**
- Panel collapsible (réduit par défaut si multiplier ≈ 1.0)
- Color coding : facteur > 1.0 → vert · < 1.0 → rouge · = 1.0 → gris
- Critère désactivé affiché grisé (non supprimé — pour visibilité)

---

## Step P3-10 — Frontend : Risk Settings page

**Quoi :**
Nouvelle page sous `/settings/risk` ou tab dans `VolatilitySettingsPage`.

**Fichiers touchés :**
```
frontend/src/pages/settings/RiskSettingsPage.tsx   ← NEW
frontend/src/components/risk/CriterionConfig.tsx   ← NEW (widget par critère)
frontend/src/App.tsx (ou router)                   ← ajouter la route
frontend/src/components/sidebar/Sidebar.tsx        ← ajouter entrée Settings
```

**Sections :**
1. **Critères actifs** — toggle enable/disable par critère, poids (input numérique, auto-normalized)
2. **Facteurs VI** — tableau éditable Regime → facteur (Market VI et Pair VI séparément)
3. **Facteurs MA Direction** — 3 champs (aligned / neutral / opposed)
4. **Bornes WR & Confidence** — min_factor / max_factor par critère
5. **Plafond global** — `global_multiplier_max` slider (1.0 → 3.0)
6. Preview live — simulateur : entrer des valeurs hypothétiques → voir le multiplier produit

---

## Step P3-11 — Frontend : Dashboard alert banner

**Quoi :**
Enrichir le dashboard avec un banner conditionnel.

**Fichiers touchés :**
```
frontend/src/pages/dashboard/DashboardPage.tsx    ← ajouter fetch budget + afficher banner
frontend/src/components/risk/RiskAlertBanner.tsx  ← NEW
```

**Logique :**
```typescript
// Au load dashboard : GET /api/risk/budget/{profile_id}
// Si alert_risk_saturated = true → afficher le banner
```

**Design :**
```
┌─────────────────────────────────────────────────────────────────┐
│ ⚠️  Risque concurrent saturé (6.0%)  ·  1 ordre LIMIT en attente │
│     Pensez à fermer vos ordres LIMIT avant d'ouvrir de nouvelles │
│     positions.                                    [Voir trades →] │
└─────────────────────────────────────────────────────────────────┘
```

Couleur : `amber-900 / amber-400` (attention, pas bloquant).

---

## Step P3-12 — Tests + QA

**Tests backend :**
```
tests/risk_management/test_engine.py      ← unit tests compute_risk_multiplier
tests/risk_management/test_advisor_api.py ← integration tests /api/risk/advisor
tests/risk_management/test_budget_api.py  ← integration tests /api/risk/budget
tests/test_trades.py                      ← enrichir : test blocage budget + force
```

**Checklist QA manuelle :**
- [ ] Formulaire trade : Risk Advisor se déclenche + Pair VI fetché live
- [ ] Override manuel appliqué dans le payload
- [ ] Trade avec budget insuffisant → 422 clair côté UI
- [ ] `force=True` → trade ouvert, snapshot persisté
- [ ] Dashboard : banner n'apparaît que si conditions réunies
- [ ] Settings risk : save → GET retourne la nouvelle config
- [ ] Désactiver un critère → non inclus dans le calcul

---

## Step P3-13 — Deploy prod Dell

Suivre la procédure standard :
1. PR `develop → main` sur GitHub
2. CD `atd-deploy.yml` déclenché automatiquement (build → push GHCR → deploy Dell)
3. Vérifier migrations passées sur prod (`make prod-migrate` ou via SSH)
4. Healthcheck `scripts/prod/healthcheck.sh`

**À vérifier avant merge :**
- [ ] `risk_settings` table créée par la migration Phase 3
- [ ] `trades.dynamic_risk_snapshot` colonne présente
- [ ] Pas de breaking change sur `/api/trades` (force=False par défaut)
- [ ] `GET /api/risk/budget/{id}` retourne 200 sur un profil existant

---

## 📦 Arborescence finale Phase 3

```
src/
└── risk_management/
    ├── __init__.py
    ├── defaults.py      ← DEFAULT_RISK_CONFIG (JSONB par défaut)
    ├── engine.py        ← compute_risk_multiplier()
    ├── models.py        ← SQLAlchemy RiskSettings model
    ├── router.py        ← /api/risk/* routes
    ├── schemas.py       ← RiskAdvisorRequest/Result, RiskSettingsOut, etc.
    └── service.py       ← orchestration + repo layer

frontend/src/
├── components/risk/
│   ├── RiskAdvisorPanel.tsx
│   ├── RiskAlertBanner.tsx
│   └── CriterionConfig.tsx
├── pages/settings/
│   └── RiskSettingsPage.tsx
├── lib/api/
│   └── risk.ts
└── types/
    └── risk.ts

tests/risk_management/
    ├── test_engine.py
    ├── test_advisor_api.py
    └── test_budget_api.py

database/migrations/versions/
    └── XXXX_phase3_risk_settings.py
```

---

## 🔗 Dépendances inter-steps

```
P3-1  (migration)
  └─► P3-4  (settings CRUD)
  └─► P3-5  (budget API)
  └─► P3-7  (guard dans open_trade)

P3-2  (engine)
  └─► P3-6  (advisor API — orchestre tout)
  └─► P3-12 (tests)

P3-3  (live pair VI)
  └─► P3-6  (advisor API)

P3-4 + P3-5 + P3-6
  └─► P3-9  (frontend advisor panel)
  └─► P3-10 (frontend settings)
  └─► P3-11 (frontend dashboard banner)

P3-7  (guard)
  └─► P3-9  (frontend gère la réponse 422)

P3-12 (tests)
  └─► P3-13 (deploy)
```

**Ordre recommandé d'implémentation :**
`P3-1 → P3-2 → P3-3 → P3-4 → P3-5 → P3-6 → P3-7 → P3-8 → P3-9 → P3-10 → P3-11 → P3-12 → P3-13`
