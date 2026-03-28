# 🤖 Phase 5 — Trade Automation (Kraken Execution)

**Date:** 28 mars 2026
**Version:** 1.0
**Status:** 📝 Design validé — implémentation à venir

> Ce document synthétise toutes les décisions de design de Phase 5.
> Voir `AlphaTradingDesk-ops/docs/deployment/phases/phase5/pre-implement-phase5.md` pour le scope détaillé.
> Voir `AlphaTradingDesk-ops/docs/deployment/phases/phase5/implement-phase5.md` pour le plan step-by-step.

---

## 🎯 Objectif

Phase 5 connecte ATD à **Kraken Futures** (futures.kraken.com) pour exécuter automatiquement les
ordres (entrée, SL, TP) depuis le journal — sans quitter ATD.

L'automatisation est **opt-in par trade** : un profil peut avoir des trades manuels et des trades
automatisés en parallèle.

---

## 🔑 Décisions de design

### Capital & Profils — inchangés
- Pas de sync balance Kraken ↔ `capital_current` du profil.
- Un profil = **allocation fictive** d'une partie du capital Kraken réel.
- Le capital est géré **indirectement** via les PnL réalisés des trades (comme en Phase 1).

### Automation opt-in par trade
- Champ `automation_enabled BOOLEAN` sur `trades`.
- Si `false` : trade journal pur, aucun appel Kraken — comportement Phase 1/2/3.
- Si `true` : ATD pilote l'ouverture, SL, TP, et le cycle de vie sur Kraken.

### ATD = source de vérité côté ouverture
- Toujours initié depuis ATD — on ne lie pas un ordre Kraken existant.
- Après exécution Kraken → on lit le fill réel (prix, size) et on update le trade en DB.

### Désactivation post-ouverture → lazy
- Si l'user désactive l'automation sur un trade `open` → on **ne touche pas** aux ordres Kraken actifs.
- L'user gère manuellement la fermeture sur Kraken par la suite.

### Mode démo / sandbox
- `KRAKEN_DEMO=true` → client pointe vers `demo-futures.kraken.com`.
- Activé par défaut en `APP_ENV=dev`.
- Désactivé en `APP_ENV=prod` (doit être explicitement activé si besoin).

---

## 🏗️ Nouveau module `src/kraken_execution/`

```
src/kraken_execution/
├── __init__.py
├── client.py        → KrakenExecutionClient (HMAC-SHA512 auth)
├── precision.py     → quantize_size() — critique, full Decimal
├── service.py       → AutomationService (open, close, breakeven, cancel)
├── tasks.py         → Celery tasks lifecycle (poll_pending, sync_positions, pnl_status)
├── router.py        → API routes (settings CRUD + manual triggers)
├── schemas.py       → Pydantic I/O schemas
└── models.py        → KrakenOrder, AutomationSettings DB models
```

---

## ⚙️ Précision des quantités — CRITIQUE

Chaque instrument a un `contract_value_precision` (entier, signé) stocké dans la table `instruments` :

| Symbol | prec | min_lot | Exemple size brut | Quantisé correct |
|---|---|---|---|---|
| PF_XBTUSD | 4 | 0.0001 | 0.03754 | 0.0375 |
| PF_ETHUSD | 3 | 0.001 | 0.1376 | 0.137 |
| PF_BONKUSD | -3 | 1000 | 42600.4 | 42000 |

**Règle :** `quantize_size(x, min_lot) = floor(x / min_lot) * min_lot`
- **Toujours Decimal** — jamais float (erreurs d'arrondi fatales avec de l'argent réel).
- Avant tout envoi à Kraken → validation que `size >= min_lot`.
- `contract_value_precision` est rempli par `sync_instruments` (Celery daily).

---

## 🔄 Cycle de vie — MARKET trade (automation ON)

```
open_trade() API call
  → [validation ATD: risk, leverage, guard]
  → place_market_order(size, symbol)           # POST /derivatives/api/v3/sendorder
  → trade.status = 'open'
  → trade.kraken_entry_order_id = order_id

[Celery sync_open_positions / 60s]
  → GET /derivatives/api/v3/fills              # fill réel
  → update trade.entry_price, trade.margin_used  si différent
  → place_sl_order(sl_price)                   # lors du 1er fill détecté
  → place_tp_orders(tp1, tp2, tp3)
  → notif "Trade ouvert — BTC/USD LONG @X"
```

---

## 🔄 Cycle de vie — LIMIT trade (automation ON)

```
open_trade() API call
  → place_limit_order(size, symbol, entry_price)   # POST /sendorder type=lmt
  → trade.status = 'pending'
  → notif "Limite posée — BTC/USD LONG @X"

[Celery poll_pending_orders / 30s]
  → GET /derivatives/api/v3/openorders
  → si order filled:
      → update trade.status = 'open', trade.entry_price = fill_price
      → place_sl_order(sl_price)
      → place_tp_orders(tp1, tp2, tp3)
      → notif "Limite triggered — BTC/USD LONG @X.XX (slippage: +0.01%)"
```

---

## 🔄 Cycle de vie — Lifecycle continu (automation ON)

```
[Celery sync_open_positions / 60s]
  → Pour chaque trade open + automation_enabled:
      → GET /openpositions → sync unrealized PnL
      → GET /fills (depuis last_checked_at)
      → Si fill = TP1:
          → partial_close(position_1), update PnL
          → notif "TP1 pris — +$X.XX"
      → Si fill = SL:
          → close_trade(realized_pnl)
          → notif "SL touché — -$X.XX"
      → Si fill = TP2/3:
          → partial_close(position_2/3), close_trade si dernier
          → notif "TP2/3 pris — +$X.XX"

[Celery pnl_status / configurable par trade]
  → notif "BTC/USD LONG — Entrée $X, Prix actuel $Y, PnL non-réalisé: +$Z"
```

---

## 🛑 Idempotence & réconciliation

- À chaque démarrage de Celery → `sync_open_positions` s'exécute immédiatement (bootstrap).
- La réconciliation compare `kraken_orders.status` (DB) vs `GET /openorders` + `GET /fills` (Kraken).
- Statuts possibles : `pending | open | filled | cancelled | error`.
- Les fills Kraken sont idempotents : on stocke `kraken_fill_id` dans `kraken_orders` pour éviter le double-traitement.

---

## 📣 Notifications — nouveaux events

| Event | Telegram contenu |
|---|---|
| `LIMIT_PLACED` | Pair, direction, limite price, size, leverage |
| `LIMIT_FILLED` | Pair, fill price, slippage vs entry, SL et TP posés |
| `TRADE_OPENED` | Pair, direction, entry price, SL, TP1/2/3 |
| `TP1_TAKEN` | Pair, TP1 price, PnL partiel, PnL restant estimé |
| `TP2_TAKEN` | idem TP2 |
| `TP3_TAKEN` | idem TP3 |
| `SL_HIT` | Pair, SL price, PnL final |
| `BE_MOVED` | Pair, nouveau SL = entry price |
| `PNL_STATUS` | Pair, entry, prix actuel, PnL non-réalisé (fréquence configurable) |
| `ORDER_ERROR` | Pair, erreur Kraken (insufficient margin, rate limit, etc) |

---

## 📋 Tables DB nouvelles — résumé

| Table | Rôle |
|---|---|
| `automation_settings` | Config Table Pattern (JSONB) — clés API chiffrées Fernet, flags |
| `kraken_orders` | Track chaque ordre Kraken (entry, SL, TP) avec statut + fill |

Colonnes ajoutées sur tables existantes :
- `instruments.contract_value_precision INTEGER` — pour `quantize_size()`
- `trades.automation_enabled BOOLEAN DEFAULT false`
- `trades.kraken_entry_order_id VARCHAR(255)` — référence rapide entry order

---

## 🔐 Sécurité des clés API

- Les clés API Kraken sont saisies dans les settings automation du profil.
- Chiffrées avec `cryptography.fernet.Fernet(settings.encryption_key)` avant stockage en DB.
- **Jamais** en clair dans les logs, les réponses API, ou les commits.
- Déchiffrement uniquement dans `KrakenExecutionClient.__init__()`, in-memory.

---

## 📊 Logging & Grafana

- Chaque appel Kraken → `structlog` avec fields : `symbol`, `order_id`, `size`, `price`, `role`, `latency_ms`.
- Chaque transition de statut trade → log `INFO` avec `trade_id`, `old_status`, `new_status`.
- Erreurs API Kraken → log `ERROR` + notif Telegram `ORDER_ERROR`.
- Dashboard Grafana **ATD — Kraken Execution** :
  - Counters : orders placed, filled, cancelled, errors (par instrument)
  - Latency : Celery task duration (poll_pending, sync_positions)
  - Timeline : fills over time
