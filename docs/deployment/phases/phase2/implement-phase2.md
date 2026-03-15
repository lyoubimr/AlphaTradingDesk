# 🛠️ Phase 2 — Implementation Plan

**Date:** 14 mars 2026
**Version:** 1.0
**Status:** ✅ Phase 2 COMPLETE — prod deploy pending (P2-19)

> Ce document décrit **quoi construire, dans quel ordre**.
> Chaque step est un incrément testable — rien n'est laissé en suspend.
> Référence scope : `pre-implement-phase2.md`
> Tests + déploiement prod : `post-implement-phase2.md`

> **Environnement dev (Steps 1–N) :** Mac local — Docker Compose dev.
> Le Dell (prod) entre en jeu au Step final (deploy).

---

## 🗺️ Roadmap Phase 2

| Step | Quoi | Statut |
|------|------|--------|
| **P2-1** | Docker Compose — Redis + Celery + TimescaleDB extension | ✅ `d9f2807` |
| **P2-2** | Alembic migrations — nouvelles tables Phase 2 | ✅ `7d69b77` |
| **P2-3** | Celery + Beat skeleton — task registry + schedules (15m/1h/4h/1d/1W) | ✅ `4235c14` |
| **P2-4** | MarketDataClient Protocol + BinanceClient + KrakenClient | ✅ `bf96552` |
| **P2-5** | Indicators engine — RVOL / MFI / ATR / BB Width + EMA Score + compute_market_vi | ✅ `8cf5f85` |
| **P2-6** | compute_pair_vi — KrakenClient + snapshots + watchlist (ema_score 0-1, regime alerts) | ✅ `e537aad` |
| **P2-7** | sync_instruments — Kraken perpetuals upsert + Binance top-100 | ✅ `25c3b94` |
| **P2-8** | cleanup_old_snapshots — TimescaleDB drop_chunks + watchlist DELETE | ✅ `5b454b8` |
| **P2-9** | API endpoints VI — market / pairs / watchlist | ✅ `cf18619` |
| **P2-10** | Settings backend — volatility + notifications GET/PUT (merge-patch) | ✅ `19b1716` |
| **P2-11** | Telegram alerting service — Market VI + Watchlists | ✅ `28531ee` |
| **P2-12** | Live Prices backend proxy — BTC/ETH (Kraken) + XAU (API tierce) | ✅ `b6e1131` |
| **P2-13** | Frontend — Market VI dashboard (`/volatility/market`) | ✅ `3c52ecd` |
| **P2-14** | Frontend — Per-pair watchlists UI (`/volatility/pairs`) | ✅ `5c2fd05` |
| **P2-15** | Frontend — Settings Volatility + Notifications UI | ✅ `79bbc02` |
| **P2-16** | Frontend — Dashboard home : Sessions + Live Prices Banner + VI widget | ✅ `a773ac1` |
| **P2-17** | Risk × Volatility integration — vi_multiplier dans formulaire trade | ✅ `a773ac1` |
| **P2-18** | QA full pass (lint + tests + manual E2E) | ⏳ |
| **P2-19** | Deploy prod Dell | ⏳ |

---

## Step P2-1 — Docker Compose : Redis + Celery + TimescaleDB

**Quoi :**
- Ajouter Redis comme service dans `docker-compose.dev.yml`
- Ajouter 2 services Celery : `celery-worker` + `celery-beat`
- Activer l'extension TimescaleDB sur le PostgreSQL existant

**Fichiers touchés :**
```
docker-compose.dev.yml       ← ajouter redis, celery-worker, celery-beat
Dockerfile.backend           ← ajouter dependencies Celery
pyproject.toml               ← ajouter celery[redis], redis, pandas-ta, python-kraken-sdk
src/core/celery_app.py       ← NEW : instance Celery + config Beat schedules
```

**Test :** `docker compose up` → tous les services healthy. `celery inspect ping` → worker répond.

---

## Step P2-2 — Alembic migrations

**Quoi :**
- Migration 1 : activer extension TimescaleDB + créer les 4 nouvelles tables
- Utiliser `op.execute()` systématiquement (règle IF NOT EXISTS / IF EXISTS)

**Fichiers touchés :**
```
database/migrations/versions/XXXX_phase2_volatility_tables.py  ← NEW
```

**Tables créées :**
- `volatility_snapshots` → hypertable sur `timestamp`
- `market_vi_snapshots` → hypertable sur `timestamp`
- `watchlist_snapshots`
- `volatility_settings`
- `notification_settings`

**Test :** `make migrate` → tables présentes, `SELECT * FROM timescaledb_information.hypertables` → 2 hypertables visibles.

---

## Step P2-3 — Celery + Beat skeleton

**Quoi :**
- `src/core/celery_app.py` : instance Celery, config broker Redis, Beat schedule
- Task stubs pour chaque TF (corps vides, juste le `@app.task` et le log)
- Beat schedule : 15m / 1h / 4h / 1d (via `crontab`)

**Fichiers touchés :**
```
src/core/celery_app.py                    ← instance + Beat config
src/volatility/__init__.py                ← NEW module
src/volatility/tasks.py                   ← stubs tasks par TF
src/volatility/scheduler.py              ← Beat schedule config
```

**Test :** Celery Beat démarre sans erreur. Les 5 tasks apparaissent dans les logs à l'heure prévue (ou manuellement avec `delay()`).

```python
# Beat schedules (celery_app.py)
beat_schedule = {
    'vi-15m':  {'task': 'task_15m',  'schedule': crontab(minute='*/15')},
    'vi-1h':   {'task': 'task_1h',   'schedule': crontab(minute=5)},
    'vi-4h':   {'task': 'task_4h',   'schedule': crontab(minute=5, hour='*/4')},
    'vi-1d':   {'task': 'task_1d',   'schedule': crontab(minute=5, hour=0)},
    'vi-1w':   {'task': 'task_1w',   'schedule': crontab(minute=0, hour=1, day_of_week='monday')},  # ← watchlist hebdo
    'sync-pairs':  {'task': 'sync_kraken_pairs', 'schedule': crontab(minute=0, hour=3)},  # quotidien 03:00
    'cleanup':     {'task': 'cleanup_old_snapshots', 'schedule': crontab(minute=0, hour=4)},
}
```

> **1W = watchlist hebdo uniquement** — le VI 1W n'entre PAS dans le score Market VI agrégé. Utile pour les setups swing/position + comme `TF+1` des watchlists 1d.

---

## Step P2-4 — MarketDataClient Protocol + clients Binance & Kraken

**Quoi :**
- Définir le `MarketDataClient` Protocol (interface commune)
- Implémenter `BinanceClient` (Market VI) + `KrakenClient` (Per-Pair)
- Injection via config (`DATA_MARKET_VI_PROVIDER` / `DATA_PAIR_VI_PROVIDER`)
- **Dev = ISO prod** : pas de fallback, Binance en dev comme en prod
- Rate limits : Binance Futures public ~1200 req/min, Kraken public ~1 req/s

**Fichiers créés :**
```
src/volatility/market_data.py     ← Protocol MarketDataClient
src/volatility/binance_client.py  ← Market VI (OHLCV + orderbook + ticker + all_symbols)
src/volatility/kraken_client.py   ← Per-Pair VI (OHLCV + orderbook + ticker + all_pairs)
```

```python
# market_data.py
class MarketDataClient(Protocol):
    def fetch_ohlcv(self, symbol: str, tf: str) -> pd.DataFrame: ...
    def fetch_orderbook(self, symbol: str) -> dict: ...
    def fetch_ticker(self, symbol: str) -> dict: ...   # {last, change_pct_24h}
    def fetch_all_symbols(self) -> list[str]: ...

def get_market_vi_client() -> MarketDataClient:
    return BinanceClient()   # DATA_MARKET_VI_PROVIDER=binance (toujours)

def get_pair_vi_client() -> MarketDataClient:
    return KrakenClient()    # DATA_PAIR_VI_PROVIDER=kraken (toujours)
```

**TF mapping (chaque client gère son propre format) :**

| TF interne | Binance | Kraken |
|-----------|---------|--------|
| `15m` | `15m` | `15` (minutes) |
| `1h` | `1h` | `60` |
| `4h` | `4h` | `240` |
| `1d` | `1d` | `1440` |
| `1W` | `1w` | `10080` |

**Test (avec fixtures — pas de call API réel) :**
```
□ BinanceClient.fetch_ohlcv mock → DataFrame avec colonnes OHLCV correctes
□ KrakenClient.fetch_ohlcv mock → idem
□ get_market_vi_client() → instance BinanceClient
□ get_pair_vi_client() → instance KrakenClient
```

**Test d'intégration (appel API réel, dev uniquement) :**
```
□ BinanceClient.fetch_ohlcv('BTCUSDT', '1h') → DataFrame non-vide
□ KrakenClient.fetch_ohlcv('PF_XBTUSD', '60') → DataFrame non-vide
□ BinanceClient.fetch_ticker('ETHBTC') → {last: ..., change_pct_24h: ...}
```

---

## Step P2-5 — Indicators engine

**Quoi :**
- Calcul des 5 indicateurs sur un DataFrame OHLCV
- EMA Score bidirectionnel (breakout/breakdown)
- Normalisation de chaque indicateur → `[0, 1]` (RVOL, MFI, ATR, BB Width, Depth)
- Chaque indicateur désactivable : si absent → score normalisé sur les actifs

**Fichiers touchés :**
```
src/volatility/indicators.py    ← NEW
    compute_rvol(df) → float
    compute_mfi(df) → float
    compute_atr_norm(df) → float
    compute_bb_width(df) → float
    compute_ema_score(df, ema_period) → (score: int, signal: str)
    normalize_components(components: dict, weights: dict) → float  ← vi_score final
```

**EMA Score — logique bidirectionnelle :**
```python
# signal values :
# 'breakout_up'      → prix vient de croiser EMA vers le haut + retest confirmé → score 100
# 'breakdown_down'   → prix vient de croiser EMA vers le bas + retest confirmé  → score 100
# 'above_ema'        → prix > EMA + 1%                                           → score 75
# 'below_ema'        → prix < EMA - 1%                                           → score 25
# 'neutral'          → prix dans ±1% de l'EMA                                   → score 50
```

**Test (unitaire) :**
```
□ compute_rvol avec volume spike → score > 0.80
□ compute_ema_score : prix > EMA +2% → signal 'above_ema', score 75
□ normalize_components avec 3 indicateurs actifs sur 5 → sum weights = 1.0
□ normalize_components avec 0 indicateur actif → raise ValueError (ne pas lancer le calcul)
```

---

## ~~Step P2-6~~ — Orderbook Depth score *(absorbé dans P2-5 — indicators.py)*

**Quoi :**
- Calculer un score de liquidité à partir du top 10 bid/ask
- Normaliser : profondeur élevée → score proche de 1

**Fichiers touchés :**
```
src/volatility/indicators.py    ← ajouter compute_depth_score(orderbook: dict) → float
```

**Logique :**
```python
# total_depth = sum(qty for bid/ask in top 10 levels)
# rolling_percentile : comparer au depth historique du pair (stocké dans volatility_settings)
# score = percentile_rank(current_depth, historical_depths)
```

**Note :** En Phase 2, si pas d'historique depth disponible → fallback : `score = 0.5` (neutre) les premiers jours.

---

## ~~Step P2-7~~ — VI Score aggregator *(absorbé dans P2-5/P2-6 — indicators.py + tasks.py)*

**Quoi :**
- Assembler les composantes → `vi_score` final
- Stocker dans `volatility_snapshots`
- Méthode centrale appelée par toutes les tasks

**Fichiers touchés :**
```
src/volatility/engine.py    ← NEW
    compute_and_store_vi(pair: str, tf: str, settings: dict) → VolatilitySnapshot
```

**Logique :**
```python
def compute_and_store_vi(pair, tf, settings):
    ohlcv = kraken_client.fetch_ohlcv(pair, tf)
    orderbook = kraken_client.fetch_orderbook(pair)
    active_indicators = settings['active_indicators']  # depuis volatility_settings

    components = {}
    if 'rvol' in active_indicators: components['rvol'] = compute_rvol(ohlcv)
    if 'mfi' in active_indicators:  components['mfi'] = compute_mfi(ohlcv)
    if 'atr' in active_indicators:  components['atr'] = compute_atr_norm(ohlcv)
    if 'bb_width' in active_indicators: components['bb_width'] = compute_bb_width(ohlcv)
    if 'depth' in active_indicators: components['depth'] = compute_depth_score(orderbook)

    ema_period = settings['ema_periods'].get(tf, 200)
    components['ema_score'], components['ema_signal'] = compute_ema_score(ohlcv, ema_period)

    vi_score = normalize_components(components, weights=settings['indicator_weights'])
    save_snapshot(pair, tf, vi_score, components)
    return vi_score
```

---

## ~~Step P2-8~~ — Market VI *(absorbé dans P2-5 — compute_market_vi dans tasks.py)*

**Quoi :**
- Task Celery Beat toutes les 15 min
- Agrège `vi_score` des ~50 pairs configurés (depuis `volatility_snapshots`)
- Calcule BTC weight (configurable) + redistribution weekend
- Détermine le régime → stocke dans `market_vi_snapshots`

**Fichiers touchés :**
```
src/volatility/tasks.py        ← implémenter compute_market_vi_task()
src/volatility/market_vi.py    ← NEW : aggregate_market_vi(pair_scores, settings) → (score, regime)
                                        detect_regime(score, percentiles) → str
```

**Test :**
```
□ aggregate_market_vi : BTC weight 50% → BTC domine correctement le score
□ Weekend auto-détecté (mock datetime) → 1d exclu, poids 50/40/10
□ detect_regime : score 0.81 → 'ACTIF' (si seuil 82e = 0.82)
□ detect_regime : score 0.83 → 'EXTREME' (si seuil 82e = 0.82)
```

---

## Step P2-6 — Per-Pair VI + Watchlists

**Quoi :**
- 5 tasks Celery Beat (15m / 1h / 4h / 1d / **1W**)
- Pour chaque TF : calculer VI de tous les pairs watchlist configurés
- Générer une watchlist si paires au-dessus du seuil
- Stocker watchlist dans `watchlist_snapshots` avec rang TF+1
- **1W** : générée le lundi 01:00 UTC — utile pour setups swing/position + comme `TF+1` des watchlists 1d
- **1W n'entre PAS dans le Market VI agrégé** (trop lent pour le score temps-réel)

**Fichiers touchés :**
```
src/volatility/tasks.py             ← implémenter task_15m / task_1h / task_4h / task_1d
src/volatility/watchlist.py         ← NEW : generate_watchlist(tf, pair_scores, settings) → WatchlistSnapshot
                                            build_tv_format(watchlist) → str
                                            enrich_with_tf_sup(pairs, tf) → pairs avec tf_sup_regime + tf_sup_vi
```

**Horaires d'exécution configurables :**
```python
# Celery Beat lit les settings de la DB au démarrage (refresh si changement)
# Si TF désactivé pour un jour/heure → task skippée silencieusement
```

---

## Step P2-7 — sync_instruments (Kraken perpetuals + Binance top-100)

**Quoi :**
- Task Celery périodique (1 fois/jour, 03:00 UTC)
- Endpoint on-demand : `POST /settings/volatility/sync-pairs`
- **Upsert dans la table `instruments` existante** (même table que Phase 1)
- Remplace le seed statique pour les pairs Kraken — les nouveaux pairs listés par Kraken sont ajoutés automatiquement
- **Pair délisté** : `is_active = false` (jamais de DELETE — les trades historiques référencent l'instrument)
- Les instruments Vantage (CFD) ne sont **pas touchés** (filtre sur `broker.name = 'Kraken'`)

**Logique :**
```python
def sync_kraken_pairs():
    pairs = kraken_client.fetch_all_symbols()  # GET /derivatives/api/v3/instruments
    broker_id = get_broker_id('Kraken')
    synced_symbols = []
    for pair in pairs:
        db.execute("""
            INSERT INTO instruments (symbol, display_name, broker_id, asset_class, is_active, updated_at)
            VALUES (:symbol, :display_name, :broker_id, 'crypto', true, NOW())
            ON CONFLICT (symbol) DO UPDATE
                SET display_name = EXCLUDED.display_name,
                    is_active    = true,
                    updated_at   = NOW()
        """)
        synced_symbols.append(pair['symbol'])
    # Pairs absents de l'API Kraken → désactivés silencieusement
    db.execute("""
        UPDATE instruments SET is_active = false
        WHERE broker_id = :broker_id AND symbol NOT IN :synced_symbols
    """)
```

> **Le seed `seed_instruments.py` reste** pour le bootstrap dev/test. En prod, la Celery task prend le relais dès le premier run.

**Synchro Binance top 100 (Market VI pairs) :**
En parallèle, la même task synchronise le top 100 pairs Binance Futures par volume :
```python
def sync_binance_top_pairs():
    # GET /fapi/v1/ticker/24hr → trié par quoteVolume DESC, top 100
    # Stocké dans volatility_settings JSONB : 'available_market_vi_pairs'
    # L'UI lit cette liste pour proposer le multi-select des 50 pairs Market VI
    ...
```

**Fichiers touchés :**
```
src/volatility/tasks.py        ← sync_kraken_pairs_task() + sync_binance_top_pairs_task()
src/volatility/router.py       ← POST /settings/volatility/sync-pairs
```

**Test :**
```
□ sync_kraken_pairs_task() → table instruments mise à jour
□ Pair absent de l'API Kraken → is_active = false (jamais DELETE)
□ Instruments Vantage non touchés
□ sync_binance_top_pairs_task() → JSONB 'available_market_vi_pairs' contient 100 pairs
□ POST /settings/volatility/sync-pairs → retourne {kraken_updated: N, binance_top_updated: 100}
```

---

## Step P2-8 — cleanup_old_snapshots

**Quoi :** Task Celery quotidienne (04:00 UTC) — purge des vieilles snapshots volatilité.
- TimescaleDB `drop_chunks` sur `volatility_snapshots` + `market_vi_snapshots` (>90j)
- DELETE sur `watchlist_snapshots` non-TimescaleDB (>90j)
- Retention configurable via `VolatilitySettings.retention_days`

**Commit :** `5b454b8`

---

## Step P2-9 — API endpoints VI

**Quoi :** Exposer les données de volatilité au frontend.

**Fichiers touchés :**
```
src/volatility/router.py    ← NEW (ou enrichi)
src/volatility/schemas.py   ← NEW
src/volatility/service.py   ← NEW
```

**Endpoints :**
```
GET  /vi/market                    → MarketVIResponse (score, regime, historique 24h)
GET  /vi/pairs                     → list[PairVIResponse] (derniers snapshots, triés par vi_score)
GET  /vi/pair/{pair}/{tf}          → float (trigger on-demand, non stocké)
GET  /vi/watchlist/{tf}            → WatchlistResponse (dernière watchlist du TF)
GET  /vi/watchlists?tf=15m&page=1  → PaginatedWatchlists
GET  /vi/watchlist/{id}/download   → PlainTextResponse (format TradingView)
GET  /prices/live                  → LivePricesResponse (BTC, ETH, XAU)
```

---

## Step P2-10 — Settings backend

**Quoi :**
```
GET/PUT /settings/volatility      → VolatilitySettings (market VI + per-pair + régimes + horaires)
GET/PUT /settings/notifications   → NotificationSettings (bots Telegram + alertes)
```

**Fichiers touchés :**
```
src/volatility/router.py     ← routes settings
src/volatility/schemas.py    ← VolatilitySettings, NotificationSettings
src/volatility/service.py    ← get/update settings avec validation
```

---

## Step P2-11 — Telegram alerting

**Quoi :**
- Service envoi message Telegram (via `httpx` → Telegram Bot API)
- Alert Market VI : cooldown géré en DB (timestamp dernier envoi)
- Alert Watchlist : format enrichi avec régimes + EMA signals + conclusion

**Fichiers touchés :**
```
src/volatility/telegram.py    ← NEW
    send_market_vi_alert(settings, snapshot)
    send_watchlist_alert(settings, watchlist)
    format_watchlist_message(watchlist) → str
    _send(bot_token, chat_id, text)
```

**Format message watchlist :**
```
ATD Watchlist — 1H (14/03 15:00 UTC)
Régime marché : ACTIF (0.71) | BTC: 0.73 | ETH/BTC: ↘ (0.84x)

EXTRÊME (> 0.80)
  • ETHUSDT   0.89  ↑ breakout+retest  +4.2%
  • SOLUSDT   0.85  ↑ above EMA        +2.8%

ACTIF (0.63–0.80)
  • AVAXUSDT  0.74  → neutral          +1.1%
  • DOTUSDT   0.67  ↓ below EMA        -0.3%

→ 4 pairs | 50 monitored
Conclusion: marché actif, EXTRÊME concentré sur ETH+SOL — favoriser LTF sur breakouts confirmés
```

**Test :**
```
□ send message test via POST /settings/notifications/test → message reçu sur Telegram
□ cooldown respecté : 2 alerts en moins de 30 min → seule la première envoyée
```

---

## Step P2-12 — Live Prices backend proxy

**Quoi :**
- `GET /prices/live` → BTC + ETH depuis Kraken Ticker + XAU depuis API tierce
- Backend proxy (ne pas exposer la clé API XAU au frontend)
- Cache Redis 30s (éviter trop de calls API)

**Fichiers touchés :**
```
src/volatility/prices.py     ← NEW : fetch_btc_eth() + fetch_xau() + get_live_prices()
src/volatility/router.py     ← GET /prices/live
src/core/config.py           ← XAU_API_KEY + XAU_API_PROVIDER settings
```

**Note :** Source XAU (D17 ouvert) → Metals-API / Twelve Data / Alpha Vantage. Configurable via env var `XAU_API_PROVIDER`.

---

## Step P2-13 — Frontend : Market VI dashboard

**Quoi :** Page `/volatility/market`

```
□ Score actuel (gauge ou grand chiffre) + badge régime (couleur)
□ BTC VI + ETH/BTC context (indicateur contextuel)
□ Historique 24h (sparkline ou mini-chart)
□ Breakdown composantes (RVOL / MFI / ATR / BB / Depth) — si activées
□ Info-bulle par régime (interprétation + style recommandé)
□ Aucun emoji prefix sur les labels — couleur CSS uniquement
```

**Fichiers touchés :**
```
frontend/src/pages/volatility/MarketVIPage.tsx   ← NEW
frontend/src/components/volatility/              ← NEW dossier
    MarketVIGauge.tsx
    RegimeBadge.tsx       ← badge couleur + nom + tooltip
    VISparkline.tsx
frontend/src/lib/api.ts    ← ajouter viApi.*
frontend/src/types/api.ts  ← MarketVIResponse, PairVIResponse, WatchlistResponse
```

---

## Step P2-14 — Frontend : Watchlists UI

**Quoi :** Page `/volatility/pairs`

```
□ Folders par date → sous-folders par TF → lignes watchlist
□ Chaque ligne : nom | régime | n pairs | heure | bouton Afficher | bouton DL (TV format)
□ Expand inline : tableau 7 colonnes (Pair | VI | Régime | EMA Signal | 24h% | TF+1 | ⚠️)
□ ⚠️ : ⚠️ si EXTRÊME, ⛔ si MORT, vide sinon → emoji sémantique uniquement
□ Filtre par TF, par régime dominant
```

**Fichiers touchés :**
```
frontend/src/pages/volatility/WatchlistsPage.tsx     ← NEW
frontend/src/components/volatility/
    WatchlistFolder.tsx
    WatchlistRow.tsx
    WatchlistInlineTable.tsx
```

---

## Step P2-15 — Frontend : Settings Volatility + Notifications

**Quoi :** Page `/settings/volatility` + `/settings/notifications`

```
Settings Volatility — Market VI :
□ Source de données : badge readonly 'Binance Futures' (configurable via env, affiché en info)
□ Poids BTC, TFs actifs, poids semaine (sliders sum=100%), poids weekend
□ Régimes : sliders pour les 5 seuils percentile
□ Rolling window : select 30j/60j/90j
□ Sélection des 50 pairs Market VI :
    - Affiche les 100 top pairs Binance (triés par volume) avec son VI courant si disponible
    - 50 pré-sélectionnés par défaut (top volume)
    - Multi-select modifiable : checkbox par pair, indicateur de volume rank
    - Bouton 'Réinitialiser aux 50 top volume'

Settings Volatility — Per-Pair :
□ Multi-select pairs watchlist (depuis instruments Kraken actifs)
□ Indicateurs : toggles RVOL/MFI/ATR/BB/Depth
□ Horaires d'exécution : par TF, plages horaires + jours
□ Retention : snapshots + watchlists
□ Sync pairs : bouton + date dernière sync (Kraken + Binance top 100)

Settings Notifications :
□ Liste bots Telegram (ajout / suppression / test)
□ Alertes Market VI : toggle, bot cible, cooldown, régimes déclencheurs
□ Alertes Watchlists : par TF, toggle, cooldown, seuil VI min
```

---

## Step P2-16 — Frontend : Dashboard home enrichi

**Quoi :**

```
□ Composant TradingSessions :
    - Sessions actives (Asia / London / NY / NYSE Open / Overlap)
    - Calcul frontend UTC (zéro API)
    - Weekend : badge "Weekend — Crypto only" visible, sessions Forex affichées mais badgées inactives

□ Live Prices Banner (header) :
    - BTC | ETH | XAU — prix + 24h%
    - Format : "BTC  65,420  +1.4%"
    - Refresh toutes les 30s (polling /prices/live)
    - Sources : BTC/ETH via Kraken, XAU via API tierce proxifiée

□ Widget Market VI :
    - Score actuel + badge régime + tendance (↑↓→)
    - Lien vers /volatility/market
```

**Fichiers touchés :**
```
frontend/src/components/dashboard/
    TradingSessions.tsx     ← NEW
    LivePricesBanner.tsx    ← NEW
    MarketVIWidget.tsx      ← NEW
frontend/src/pages/DashboardPage.tsx   ← intégrer les 3 widgets
frontend/src/layouts/MainLayout.tsx    ← intégrer LivePricesBanner dans le header
```

---

## Step P2-17 — Risk × Volatility integration

**Quoi :**
- Formulaire de trade : afficher le vi_multiplier calculé
- `risk_ajusté = risk_base × f(market_vi, pair_vi)`
- Affichage info-bulle sous le champ risk

```
ℹ️ Risk ajusté par la volatilité
  Market VI : ACTIF (0.68) → ×1.15
  Pair VI (BTCUSD 1h) : NORMAL (0.45) → ×1.00
  → Risk final : 1.38% (au lieu de 1.20% de base)
```

- Override manuel possible (l'utilisateur peut ignorer la suggestion)
- Piecewise initial : MORT→×0.50, CALME→×0.85, NORMAL→×1.00, ACTIF→×1.15, EXTRÊME→×0.70
- À ajuster après tests réels (D9 ouvert)

**Fichiers touchés :**
```
src/volatility/multiplier.py       ← NEW : compute_vi_multiplier(market_vi, pair_vi) → (multiplier, breakdown)
src/risk_management/router.py      ← ajouter GET /vi/current → {market_vi, regime}
frontend/src/pages/trades/
    NewTradePage.tsx               ← intégrer vi_multiplier widget
    components/VIMultiplierInfo.tsx ← NEW
```

---

## Step P2-18 — QA full pass

**Automatisé :**
```
□ ruff + mypy → 0 erreurs
□ pytest tests/ → tous verts (ajouter tests Phase 2 : voir post-implement-phase2.md)
□ eslint + vitest → 0 erreurs
□ CI GitHub Actions (atd-test.yml) → green
```

**Manuel E2E (dev local) :**
```
□ Celery Beat démarre → tasks 15m / 1h / 4h / 1d s'exécutent
□ market_vi_snapshots alimentée après 15 min
□ Watchlist générée → visible dans UI (folders + inline)
□ DL format TV → fichier correct
□ Alert Telegram Market VI reçue sur mobile
□ Alert Telegram Watchlist reçue avec bon format
□ Dashboard home : sessions actives correctes (vérifier heure locale vs UTC)
□ Live Prices Banner : BTC/ETH/XAU s'affichent + refreshés toutes les 30s
□ Trade form : vi_multiplier affiché + override manuel fonctionne
□ Settings Volatility : modifier poids → Celery utilise les nouveaux poids au prochain run
□ Sync Kraken pairs : bouton → table instruments mise à jour
□ Weekend : auto-détecté → poids redistributés
```

---

## Step P2-19 — Deploy prod Dell

Voir `post-implement-phase2.md` — Section Déploiement.
