# 📊 Phase 2 — Volatility Engine Data Flow

**Version:** 1.0
**Date:** 14 mars 2026
**Phase:** 2 — Volatility Engine

---

## Vue d'ensemble — Deux composants indépendants

```mermaid
%%{init: {"flowchart": {"htmlLabels": false}} }%%
flowchart TD
    subgraph SOURCES["`**Sources de données**`"]
        binance["`**Binance Futures**
        fapi.binance.com
        ~50 paires configurées
        ex: BTCUSDT, ETHUSDT`"]
        kraken["`**Kraken Futures**
        futures.kraken.com
        317 paires actives
        ex: PF_BTCUSD, PF_ETHUSD`"]
    end

    subgraph ENGINE["`**Volatility Engine** — Celery Workers`"]
        marketVI["`**Market VI**
        compute_market_vi(tf)
        Agrege ~50 paires Binance
        score global 0.0-1.0`"]
        pairVI["`**Per-Pair VI**
        compute_pair_vi(tf)
        Calcule VI pour chaque
        paire Kraken active`"]
    end

    subgraph STORAGE["`**TimescaleDB** — hypertables`"]
        snap_mkt[("market_vi_snapshots
        vi_score / regime
        components JSONB
        timestamp (hypertable)")]
        snap_pair[("volatility_snapshots
        pair / timeframe
        vi_score / components
        timestamp (hypertable)")]
        snap_wl[("watchlist_snapshots
        name / timeframe
        pairs JSONB
        generated_at")]
    end

    subgraph API_LAYER["`**FastAPI** — endpoints Phase 2`"]
        e1["`GET /volatility/market/current
        Market VI score + regime`"]
        e2["`GET /volatility/pairs?tf=1h
        Per-Pair VI tous les TF`"]
        e3["`GET /volatility/watchlist?tf=1h
        Watchlist dynamique`"]
        e4["`GET /vi/current
        vi_score + regime Risk Mgmt`"]
        e5["`PUT /volatility/settings
        Config depuis UI`"]
    end

    subgraph FRONTEND["`**React Frontend** — vues Phase 2`"]
        dash["`Dashboard home
        Sessions widget
        Live Prices Banner
        Market VI widget`"]
        wl["`/volatility/watchlist
        Tableau 7 colonnes`"]
        settings["`/settings/volatility
        Paires / Horaires
        Indicateurs / Retention`"]
        risk["`Trade Form
        vi_multiplier sur risk%`"]
    end

    binance -->|OHLCV + ticker| marketVI
    kraken -->|OHLCV + orderbook| pairVI
    marketVI -->|INSERT| snap_mkt
    pairVI -->|INSERT| snap_pair
    pairVI -->|generate| snap_wl
    snap_mkt -->|SELECT latest| e1
    snap_pair -->|SELECT latest per tf| e2
    snap_wl -->|SELECT latest per tf| e3
    snap_mkt & snap_pair -->|aggregate| e4
    e5 -.->|configure| marketVI & pairVI
    e1 --> dash
    e2 & e3 --> wl
    e4 --> risk
    e5 --> settings
```

---

## Calcul VI — Pipeline indicateurs

```mermaid
%%{init: {"flowchart": {"htmlLabels": false}} }%%
flowchart LR
    raw["`OHLCV brut
    pandas DataFrame`"]

    subgraph INDICATORS["`**5 indicateurs** (tous activables/desactivables)`"]
        rvol["`**RVOL**
        vol_current / vol_avg_20
        normalise 0-1`"]
        mfi["`**MFI** 14p
        Money Flow Index
        normalise 0-1`"]
        atr["`**ATR norm** 14p
        atr / price
        normalise 0-1`"]
        bb["`**BB Width**
        (upper-lower) / middle
        normalise 0-1`"]
        ema["`**EMA Score** 20/50/200
        position relative EMAs
        0-100 bidirectionnel
        ema_signal: breakout_up
        breakdown_down above
        below + retest`"]
    end

    vi["`**VI Score** = moyenne(actifs)
    DECIMAL(5,3) in 0.000-1.000`"]

    regime{"`**Regime**
    percentiles configurables`"}

    regime_labels["`MORT    p0-p20
    CALME   p20-p40
    NORMAL  p40-p60
    ACTIF   p60-p80
    EXTREME p80-p100`"]

    jsonb["`**components JSONB**
    rvol: 0.72 / mfi: 0.58
    atr: 0.61 / bb_width: 0.44
    ema_score: 85
    ema_signal: breakout_up`"]

    raw --> rvol & mfi & atr & bb & ema
    rvol & mfi & atr & bb --> vi
    ema -.->|boost ranking watchlist| vi
    vi --> regime --> regime_labels
    vi & ema --> jsonb
```

---

## Market VI — Agregation globale

```mermaid
%%{init: {"flowchart": {"htmlLabels": false}} }%%
flowchart TD
    pairs["`~50 paires Binance
    top 100 par 24h quoteVolume
    50 pre-selectionnees (modifiables)`"]

    subgraph WEIGHTS["`**Ponderation** (settings UI)`"]
        btc_w["`BTC 30%`"]
        eth_w["`ETH 20%`"]
        others_w["`Autres 50%
        selon rang volume`"]
    end

    vi_each["`VI Score individuel
    par paire`"]

    aggregation["`Market VI = SUM(vi_i x weight_i)
    Score global 0.0-1.0`"]

    subgraph TEMPORAL["`**Weekend vs Weekday**`"]
        weekday["`Lun-Ven : Crypto + Forex + Gold`"]
        weekend["`Sam-Dim : Crypto only
        Sessions Forex = inactives`"]
    end

    db_insert["`INSERT market_vi_snapshots
    + cache Redis TTL 15min`"]

    pairs --> vi_each
    WEIGHTS --> aggregation
    vi_each --> aggregation
    aggregation --> TEMPORAL --> db_insert
```

---

## Watchlist — Colonnes et generation

```mermaid
%%{init: {"flowchart": {"htmlLabels": false}} }%%
flowchart LR
    subgraph INPUT["`**Input**`"]
        snap[("volatility_snapshots
        latest par pair+tf")]
        cfg[("volatility_settings
        paires actives")]
    end

    ranking["`**Tri** vi_score DESC
    + ema_score boost
    si signal fort`"]

    subgraph COLS["`**7 colonnes**`"]
        c1["`Pair`"]
        c2["`VI Score : 0.71`"]
        c3["`Regime : ACTIF`"]
        c4["`EMA Signal : up breakout+retest`"]
        c5["`24h % : +2.3%`"]
        c6["`TF+1 : EXTREME 0.84`"]
        c7["`Alerte : warning EXTREME
        stop MORT / vide sinon`"]
    end

    export["`Export DL TV format
    KRAKEN:BTCUSD.P`"]

    snap & cfg --> ranking
    ranking --> c1 & c2 & c3 & c4 & c5 & c6 & c7
    ranking --> export
```

**Hierarchie TF+1** : 15m→1h → 4h → 1d → 1W (masque si 1W)
