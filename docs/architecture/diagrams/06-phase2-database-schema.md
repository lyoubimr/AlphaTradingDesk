# 🗄️ Phase 2 — Database Schema

**Version:** 1.0
**Date:** 14 mars 2026
**Phase:** 2 — Volatility Engine

---

## Nouvelles tables Phase 2

5 nouvelles tables ajoutées au schema Phase 1 existant.
`volatility_snapshots` et `market_vi_snapshots` sont des **hypertables TimescaleDB**.

---

## Relations avec Phase 1

```mermaid
%%{init: {"flowchart": {"htmlLabels": false}} }%%
flowchart TD
    subgraph PHASE1["`**Tables Phase 1** (existantes)`"]
        profiles[("profiles
        id UUID PK
        name / capital
        risk% / broker_id")]
        instruments[("instruments
        id / broker_id
        symbol / asset_class
        is_active")]
        trades[("trades
        id / profile_id
        instrument_id
        direction / entry / SL")]
    end

    subgraph PHASE2["`**Tables Phase 2** (nouvelles)`"]
        vs[("volatility_snapshots
        HYPERTABLE TimescaleDB
        pair / timeframe
        vi_score / components
        timestamp")]
        mvs[("market_vi_snapshots
        HYPERTABLE TimescaleDB
        vi_score / regime
        components JSONB
        timestamp")]
        wls[("watchlist_snapshots
        name / timeframe
        regime / pairs_count
        pairs JSONB
        generated_at")]
        volt_cfg[("volatility_settings
        profile_id FK
        market_vi JSONB
        per_pair JSONB
        regimes JSONB
        updated_at")]
        notif_cfg[("notification_settings
        profile_id FK
        bots JSONB
        market_vi_alerts JSONB
        watchlist_alerts JSONB
        updated_at")]
    end

    profiles -->|1:1| volt_cfg
    profiles -->|1:1| notif_cfg
    instruments -.->|symbol reference
    Kraken per-pair| vs
    vs -.->|aggregation
    Market VI| mvs
    vs -.->|generation| wls
    trades -.->|vi_score au moment
    de l ouverture| trades
```

---

## volatility_snapshots (hypertable)

Stocke le VI calculé pour chaque paire Kraken, par timeframe.
Chunk interval = 1 jour. Compression automatique après 7 jours.

```mermaid
%%{init: {"flowchart": {"htmlLabels": false}} }%%
flowchart LR
    subgraph VS["`**volatility_snapshots**`"]
        direction TB
        pk["`PK : (pair, timeframe, timestamp)`"]
        col1["`pair VARCHAR(20)
        ex: PF_BTCUSD`"]
        col2["`timeframe VARCHAR(10)
        15m / 1h / 4h / 1d / 1W`"]
        col3["`vi_score DECIMAL(5,3)
        0.000 - 1.000
        INDEX pour queries rapides`"]
        col4["`components JSONB
        rvol / mfi / atr
        bb_width / ema_score
        ema_signal`"]
        col5["`timestamp TIMESTAMPTZ
        PARTITION KEY hypertable`"]
    end

    subgraph QUERY["`**Queries typiques**`"]
        q1["`SELECT * FROM volatility_snapshots
        WHERE timeframe='1h'
        AND timestamp > NOW()-INTERVAL '1h'
        ORDER BY vi_score DESC`"]
        q2["`SELECT * FROM volatility_snapshots
        WHERE pair='PF_BTCUSD'
        AND timeframe='1h'
        ORDER BY timestamp DESC
        LIMIT 1`"]
    end

    VS -.-> QUERY
```

---

## market_vi_snapshots (hypertable)

Stocke le score global du marche agrege sur les paires Binance.

```mermaid
%%{init: {"flowchart": {"htmlLabels": false}} }%%
flowchart LR
    subgraph MVS["`**market_vi_snapshots**`"]
        direction TB
        pk2["`PK : (timestamp)`"]
        col1["`vi_score DECIMAL(5,3)
        score global 0.000-1.000`"]
        col2["`timeframe VARCHAR(10)
        TF du calcul`"]
        col3["`regime VARCHAR(20)
        MORT / CALME / NORMAL
        ACTIF / EXTREME`"]
        col4["`components JSONB
        { BTCUSDT: 0.71
        ETHUSDT: 0.68
        SOLUSDT: 0.55
        ... }`"]
        col5["`timestamp TIMESTAMPTZ
        PARTITION KEY hypertable`"]
    end
```

---

## watchlist_snapshots

Snapshot genere apres chaque calcul per-pair. Conserve l'historique des watchlists.

```mermaid
%%{init: {"flowchart": {"htmlLabels": false}} }%%
flowchart LR
    subgraph WLS["`**watchlist_snapshots**`"]
        direction TB
        pk3["`PK : id BIGSERIAL`"]
        col1["`name VARCHAR(100)
        ex: dec2821h_Perps_15m_v14_USD_KRAKEN`"]
        col2["`timeframe VARCHAR(10)`"]
        col3["`regime VARCHAR(20)
        regime dominant`"]
        col4["`pairs_count INTEGER`"]
        col5["`pairs JSONB
        [{pair, vi_score, regime,
        ema_signal, ema_score,
        change_24h, tf_sup_regime,
        tf_sup_vi}]`"]
        col6["`generated_at TIMESTAMPTZ DEFAULT NOW()`"]
    end
```

---

## volatility_settings + notification_settings

Config JSONB par profil — tout configurable depuis l'UI, aucune migration pour ajouter un parametre.

```mermaid
%%{init: {"flowchart": {"htmlLabels": false}} }%%
flowchart TD
    subgraph VCFG["`**volatility_settings**`"]
        direction TB
        vk1["`profile_id UUID FK PK`"]
        vk2["`market_vi JSONB
        {
          pairs: [BTCUSDT, ETHUSDT...],
          weights: {BTC: 0.30, ETH: 0.20},
          active_hours_start: 08:00,
          active_hours_end: 22:00,
          weekdays_only: false,
          rolling_window: 20
        }`"]
        vk3["`per_pair JSONB
        {
          indicators: {rvol: true, mfi: true,
                       atr: true, bb: true, ema: true},
          retention_days: 30,
          active_hours_start: 00:00,
          active_hours_end: 23:59
        }`"]
        vk4["`regimes JSONB
        {
          mort_max: 0.20,
          calme_max: 0.40,
          normal_max: 0.60,
          actif_max: 0.80
        }`"]
        vk5["`updated_at TIMESTAMPTZ`"]
    end

    subgraph NCFG["`**notification_settings**`"]
        direction TB
        nk1["`profile_id UUID FK PK`"]
        nk2["`bots JSONB
        [{bot_token, chat_id, bot_name}]`"]
        nk3["`market_vi_alerts JSONB
        {
          enabled: true,
          bot_name: ATD_Market,
          cooldown_min: 60,
          regimes: [EXTREME, MORT]
        }`"]
        nk4["`watchlist_alerts JSONB
        {
          enabled: true,
          bot_name: ATD_Pairs,
          per_tf: {
            15m: {enabled: true,
                  cooldown_min: 30,
                  vi_min: 0.70}
          }
        }`"]
        nk5["`updated_at TIMESTAMPTZ`"]
    end

    profiles_ref[("profiles")]
    profiles_ref -->|profile_id FK| VCFG
    profiles_ref -->|profile_id FK| NCFG
```

---

## Schema complet Phase 1 + Phase 2

```mermaid
%%{init: {"flowchart": {"htmlLabels": false}} }%%
flowchart LR
    subgraph P1["`Phase 1`"]
        p[("profiles")]
        b[("brokers")]
        i[("instruments")]
        t[("trades")]
        pos[("positions")]
        st[("strategies")]
        ma[("market_analysis_sessions")]
        pg[("profile_goals")]
    end

    subgraph P2["`Phase 2`"]
        vs2[("volatility_snapshots
        HYPERTABLE")]
        mvs2[("market_vi_snapshots
        HYPERTABLE")]
        wls2[("watchlist_snapshots")]
        vcfg[("volatility_settings")]
        ncfg[("notification_settings")]
    end

    p --> t & pg & vcfg & ncfg
    b --> p & i
    i --> t
    t --> pos
    vs2 -.->|aggregation| mvs2
    vs2 -.->|generation| wls2
    i -.->|symbol ref| vs2
```
