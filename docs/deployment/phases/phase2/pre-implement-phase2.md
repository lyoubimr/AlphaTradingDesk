# 📐 Phase 2 — Pre-Implementation Scope

**Date:** 14 mars 2026
**Version:** 1.0
**Status:** ✅ Validé — prêt pour implémentation

> Ce document synthétise toutes les décisions de design de Phase 2.
> Référence canonique : `docs/phases/PHASE_2_VOLATILITY_DRAFT.md`
> Voir `implement-phase2.md` pour le plan d'implémentation step-by-step.
> Voir `post-implement-phase2.md` pour les tests + déploiement prod.

---

## 🎯 Scope Phase 2 — Volatility Analysis Engine

Un seul module ajouté en Phase 2 : **le moteur de volatilité**.

```
Phase 2 scope :
  1. Market Volatility Index (Market VI)     ← score global agrégé sur ~50 pairs
  2. Per-Pair Volatility + Watchlists        ← 317 pairs Kraken, par TF
  3. EMA Score (boost watchlist)             ← bidirectionnel, par TF
  4. Risk × Volatility integration           ← vi_multiplier dans le formulaire trade
  5. Alerting Telegram                       ← multi-bots, Market VI + Watchlists
  6. Dashboard home enrichi                  ← Sessions widget + Live Prices Banner + VI widget
  7. Settings Volatility + Notifications     ← tout configurable via UI
```

---

## 🏗️ Architecture — Deux composants

| Composant | Scope | Calcul | Dashboard |
|-----------|-------|--------|-----------|
| **Market VI** | Score global du marché, agrégé sur ~50 pairs configurés | Toutes les 15 min (Celery Beat) | `/volatility/market` |
| **Per-Pair VI** | 317 pairs Kraken actifs, par TF | Cadencé par TF (Celery Beat) | `/volatility/pairs` |

Les deux alimentent le Risk Management via `GET /vi/current`.

---

## 🔧 Stack — Ajouts Phase 2

| Ajout | Justification |
|-------|--------------|
| **Redis** | Broker Celery + cache scores live |
| **Celery + Celery Beat** | Tasks périodiques par TF + trigger on-demand |
| **TimescaleDB** (extension PostgreSQL existant) | Time-series robuste — retention + compression natifs |
| **python-kraken-sdk** ou REST direct | Fetch OHLCV + orderbook depth |
| **pandas-ta** | Calcul RVOL / MFI / ATR / BB Width en Python |

> Redis et Celery sont Phase 2 uniquement — ne pas ajouter en Phase 1.
> TimescaleDB est une **extension** du PostgreSQL existant — pas un nouveau conteneur.

---

## 🗄️ Nouvelles tables Phase 2

### `volatility_snapshots` (TimescaleDB hypertable sur `timestamp`)
```sql
CREATE TABLE volatility_snapshots (
    id          BIGSERIAL,
    pair        VARCHAR(20)   NOT NULL,
    timeframe   VARCHAR(10)   NOT NULL,  -- '15m', '1h', '4h', '1d'
    vi_score    DECIMAL(5,3)  NOT NULL,  -- indexable, requêtable directement
    components  JSONB         NOT NULL,  -- {"rvol": 0.72, "mfi": 0.58, "atr": 0.61, "ema_score": 85, "ema_signal": "breakout+retest_up"}
    timestamp   TIMESTAMPTZ   NOT NULL,
    PRIMARY KEY (pair, timeframe, timestamp)
);
SELECT create_hypertable('volatility_snapshots', 'timestamp');
```

### `market_vi_snapshots` (TimescaleDB hypertable sur `timestamp`)
```sql
CREATE TABLE market_vi_snapshots (
    id          BIGSERIAL,
    vi_score    DECIMAL(5,3)  NOT NULL,
    regime      VARCHAR(20)   NOT NULL,  -- 'MORT', 'CALME', 'NORMAL', 'ACTIF', 'EXTREME'
    components  JSONB         NOT NULL,  -- {pair: vi_score, ...} pour les 50 pairs
    timestamp   TIMESTAMPTZ   NOT NULL,
    PRIMARY KEY (timestamp)
);
SELECT create_hypertable('market_vi_snapshots', 'timestamp');
```

### `watchlist_snapshots`
```sql
CREATE TABLE watchlist_snapshots (
    id          BIGSERIAL PRIMARY KEY,
    name        VARCHAR(100)  NOT NULL,  -- 'dec2821h_Perps_15m_v14_USD_KRAKEN'
    timeframe   VARCHAR(10)   NOT NULL,
    regime      VARCHAR(20)   NOT NULL,  -- régime dominant de la watchlist
    pairs_count INTEGER       NOT NULL,
    pairs       JSONB         NOT NULL,  -- [{pair, vi_score, regime, ema_signal, ema_score, change_24h, tf_sup_regime, tf_sup_vi}]
    generated_at TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);
```

### `volatility_settings` (JSONB config unique par profil)
```sql
CREATE TABLE volatility_settings (
    profile_id      UUID          PRIMARY KEY REFERENCES profiles(id),
    market_vi       JSONB         NOT NULL DEFAULT '{}',   -- poids BTC, TFs, poids semaine, poids weekend, rolling window
    per_pair        JSONB         NOT NULL DEFAULT '{}',   -- pairs monitored, indicateurs actifs, seuils, retention, horaires
    regimes         JSONB         NOT NULL DEFAULT '{}',   -- percentile seuils par régime
    updated_at      TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);
```

### `notification_settings` (bots Telegram, alertes)
```sql
CREATE TABLE notification_settings (
    profile_id      UUID          PRIMARY KEY REFERENCES profiles(id),
    bots            JSONB         NOT NULL DEFAULT '[]',   -- [{bot_token, chat_id, bot_name}]
    market_vi_alerts JSONB        NOT NULL DEFAULT '{}',   -- {enabled, bot_name, cooldown_min, regimes}
    watchlist_alerts JSONB        NOT NULL DEFAULT '{}',   -- {enabled, bot_name, per_tf: {15m: {enabled, cooldown, vi_min}}}
    updated_at      TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);
```

---

## 📊 Indicateurs retenus (5)

| # | Indicateur | Catégorie | Activable/désactivable |
|---|-----------|-----------|----------------------|
| 1 | **RVOL** (vol_current / vol_avg_20) | Volume | ✅ toggle settings |
| 2 | **MFI** (Money Flow Index, 14p) | Volume + Prix | ✅ toggle settings |
| 3 | **ATR normalisé** (14p) | Prix | ✅ toggle settings |
| 4 | **Bollinger Band Width** (écart relatif) | Prix | ✅ toggle settings |
| 5 | **Orderbook Depth** (top 10 levels bid/ask) | Liquidité | ✅ toggle settings |

> Scalabilité : `components` JSONB → ajouter/retirer un indicateur sans migration Alembic.
> La formule de vi_score se normalise dynamiquement sur les indicateurs actifs.

---

## 📈 TFs et poids

| TF | Cadence | Poids semaine | Poids weekend |
|----|---------|--------------|---------------|
| **15m** (LTF) | toutes les 15 min | 25% | **50%** |
| **1h** (MTF) | toutes les heures | 40% | **40%** |
| **4h** (HTF) | toutes les 4h | 25% | **10%** |
| **1d** (HTF2) | 1 fois/jour | 10% | **0% — exclu** |

> Score agrégé final semaine = `25% × VI_15m + 40% × VI_1h + 25% × VI_4h + 10% × VI_1d`
> Weekend (sam/dim UTC) = auto-détecté, 1d exclu, poids redistributés → configurables en settings.
> Pas de 1W dans l'agrégation.

---

## 🎨 5 Régimes

| Régime | Couleur | Condition défaut | VI range (exemple) | Alert |
|--------|---------|-----------------|-------------------|-------|
| **MORT** | `#6b7280` gris | < 20e percentile | 0.00 – 0.22 | ⛔ |
| **CALME** | `#3b82f6` bleu | 20e – 45e percentile | 0.22 – 0.45 | |
| **NORMAL** | `#22c55e` vert | 45e – 65e percentile | 0.45 – 0.63 | |
| **ACTIF** | `#f59e0b` orange | 65e – 82e percentile | 0.63 – 0.80 | |
| **EXTRÊME** | `#ef4444` rouge | > 82e percentile | 0.80 – 1.00 | ⚠️ |

> Tous les seuils sont paramétrables en settings (20/45/65/82 par défaut).
> Emojis d'alerte (⚠️ / ⛔) = signal sémantique uniquement. Pas de prefix emoji sur les labels de régime en UI.

---

## 🔢 EMA Score

- EMA de référence par TF : 15m→EMA50 / 1h→EMA100 / 4h→EMA200 / 1d→EMA200 (configurables)
- Score bidirectionnel (0–100) : breakout haussier OU breakdown baissier = score 100
- Stocké dans `components` JSONB (`ema_score`, `ema_signal`)
- N'entre pas dans `vi_score` — agit comme **boost de ranking** dans la watchlist
- Ranking : `ORDER BY vi_score DESC, ema_score DESC`

---

## 📋 Watchlist — Spécification

### Format nom
`{date}{heure}_Perps_{TF}_v{n}_{quote}_{exchange}` → ex. `dec2821h_Perps_15m_v14_USD_KRAKEN`

### Format TradingView (download)
```
KRAKEN:CTSIUSD.PM
KRAKEN:TRXUSD.PM
```

### Contenu inline (7 colonnes max)

| Pair | VI Score | Régime | EMA Signal | 24h % | TF+1 | ⚠️ |
|------|----------|--------|------------|-------|------|-----|
| CTSIUSD | 0.82 | EXTRÊME | ↑ breakout+retest | +4.2% | ACTIF · 0.71 | ⚠️ |
| SOLUSDT | 0.68 | ACTIF | ↓ breakdown+retest | -2.3% | NORMAL · 0.55 | |

> `VI Score` et `TF+1` en `0.xx` (échelle native). `TF+1` = régime + VI du TF supérieur depuis `volatility_snapshots`. Alerte ⚠️/⛔ = régime du TF courant uniquement.

---

## 🆕 Endpoints Phase 2

| Route | Méthode | Rôle |
|-------|---------|------|
| `GET /vi/market` | GET | Score Market VI actuel + historique + régime |
| `GET /vi/pairs` | GET | Dashboard per-pair ranking (derniers snapshots) |
| `GET /vi/pair/{pair}/{tf}` | GET | VI on-demand d'un pair sur un TF (live, non stocké) |
| `GET /vi/watchlist/{tf}` | GET | Dernière watchlist générée pour un TF |
| `GET /vi/watchlists` | GET | Liste toutes les watchlists (paginée, filtrée par TF/date) |
| `GET /vi/watchlist/{id}/download` | GET | TradingView format (text/plain) |
| `GET/PUT /settings/volatility` | GET/PUT | Config Market VI + Per-Pair VI + Régimes |
| `GET/PUT /settings/notifications` | GET/PUT | Bots Telegram + alertes |
| `POST /settings/volatility/sync-pairs` | POST | Sync Kraken pairs (trigger manuel) |
| `GET /prices/live` | GET | BTC + ETH + XAU prix live (proxy backend) |

---

## 🎯 Décisions validées

| # | Décision | Retenu |
|---|---------|--------|
| D1 | Indicateurs core | RVOL + MFI + ATR + BB Width + Depth — on/off depuis settings |
| D2 | TFs + poids | 25/40/25/10 — pas de 1W |
| D3 | Weekend logic | Auto-détection — redistribution 50/40/10/0 — configurable |
| D4 | JSONB scalabilité | vi_score DECIMAL + components JSONB — zero migration pour add/disable indicateur |
| D5 | TimescaleDB | Dès Phase 2 — hypertables + retention policies natifs |
| D6 | BTC weight | 50% configurable, proxy Kraken-native |
| D7 | Rolling window | 90j défaut, configurable 30/60/90j |
| D8 | Régimes | MORT/CALME/NORMAL/ACTIF/EXTRÊME — couleurs CSS — seuils paramétrables — VI range absolu affiché |
| D10 | Telegram multi-bots | Bot Market VI + Bot Watchlists (extensible) |
| D12 | Watchlists DB | Stockées + live + retention configurable |
| D13 | 317 pairs dynamiques | Sync Celery quotidienne + bouton manuel settings |
| D15 | Sessions dashboard | Frontend, Dashboard home, sessions badgées en weekend (pas cachées) |
| D16 | ETH/BTC cross | Récupéré à part, indicateur contextuel (pas dans vi_score agrégé) |
| D18 | EMA Score | Bidirectionnel, boost ranking watchlist, ema_score + ema_signal dans JSONB |
| D19 | Horaires watchlists | Config plages horaires + jours par TF en settings |
| D20 | Watchlist UI | Folders date/TF, DL format TV, tableau 7 cols max |

## 🔄 Décisions ouvertes

| # | Décision | Statut |
|---|---------|--------|
| D9 | vi_multiplier forme (piecewise vs sigmoid) | Déféré à l'implémentation Risk × Vol |
| D14 | Double-TF confirmation alerts Telegram | Déféré à l'implémentation |
| D17 | Source API pour XAU (Gold live price) | À confirmer : Metals-API / Twelve Data / Alpha Vantage |

---

## 🚫 Non-goals Phase 2

- Auto-trading Kraken (Phase 4)
- ML/prediction sur le VI score
- Monitoring 317 pairs en continu (Phase 3)
- OI/Volume, Funding Rate dans les watchlists (Phase 3 — Kraken Futures API)
- Multi-EMA par TF (Phase 3 — preset avancé)
- Redis / Celery en Phase 1 (ne pas anticiper)
