# ✅ Phase 2 — Post-Implementation Checklist

**Date:** 14 mars 2026
**Version:** 1.0
**Status:** À faire après `implement-phase2.md` complété

> Ce document couvre ce qu'il faut faire **après** que Phase 2 tourne localement.
> Référence scope : `pre-implement-phase2.md`
> Plan de build : `implement-phase2.md`

---

## 1. 🧪 Tests automatisés — À ajouter en Phase 2

### Tests unitaires (pytest)

```
Indicators engine :
  □ compute_rvol : volume spike → score > 0.80
  □ compute_rvol : volume faible → score < 0.30
  □ compute_mfi : overbought → score proche de 1.0
  □ compute_atr_norm : ATR élevé → score proche de 1.0
  □ compute_bb_width : squeeze (bandes serrées) → score proche de 0
  □ compute_ema_score : prix > EMA +2% → signal 'above_ema', score 75
  □ compute_ema_score : breakout+retest haussier → signal 'breakout_up', score 100
  □ compute_ema_score : breakdown+retest baissier → signal 'breakdown_down', score 100
  □ compute_ema_score : prix dans ±1% EMA → signal 'neutral', score 50

VI Score aggregator :
  □ normalize_components : 5 indicateurs actifs → sum weights = 1.0, score ∈ [0, 1]
  □ normalize_components : 3 indicateurs actifs (2 désactivés) → idem, sans erreur
  □ normalize_components : 0 indicateur → ValueError levée

Market VI :
  □ aggregate_market_vi : BTC weight 50% → score influencé à 50% par BTC
  □ aggregate_market_vi weekend (mock Saturday) → 1d exclu, poids 50/40/10
  □ detect_regime : score 0.19 → 'MORT'
  □ detect_regime : score 0.30 → 'CALME'
  □ detect_regime : score 0.55 → 'NORMAL'
  □ detect_regime : score 0.70 → 'ACTIF'
  □ detect_regime : score 0.85 → 'EXTREME'

vi_multiplier :
  □ compute_vi_multiplier : market=ACTIF, pair=NORMAL → multiplier 1.15 × 1.00 = 1.15
  □ compute_vi_multiplier : market=EXTREME, pair=EXTREME → multiplier réduit (≤ 0.80)
  □ compute_vi_multiplier : market=MORT → multiplier ≤ 0.50

Watchlist :
  □ generate_watchlist : 3 pairs au-dessus seuil → watchlist avec 3 pairs
  □ generate_watchlist : 0 pairs au-dessus seuil → watchlist vide (pas stockée)
  □ build_tv_format : pairs → format 'KRAKEN:XXXX.PM' multiligne
  □ enrich_with_tf_sup : pair 15m → tf_sup_regime et tf_sup_vi depuis volatility_snapshots 1h

Telegram :
  □ format_watchlist_message : produit message bien formé (bot token jamais logué)
  □ cooldown respecté : send × 2 en < 30 min → 1 seul envoi effectif
```

### Tests d'intégration (pytest + DB test)

```
  □ compute_and_store_vi : snapshot sauvegardé dans volatility_snapshots
  □ market_vi_snapshot : stocké dans market_vi_snapshots après aggregate
  □ watchlist stored : watchlist_snapshots contient la watchlist générée
  □ GET /vi/market : retourne le dernier snapshot
  □ GET /vi/watchlist/1h : retourne la dernière watchlist 1h
  □ GET /vi/watchlist/{id}/download : Content-Type text/plain, format TV correct
  □ PUT /settings/volatility : mise à jour persistée en DB
  □ POST /settings/volatility/sync-pairs : table instruments mise à jour
  □ GET /prices/live : retourne BTC, ETH, XAU avec last_price et change_pct
```

---

## 2. ✅ Validation fonctionnelle manuelle

### Flux complet Celery

```
  □ Démarrer docker compose → celery-worker + celery-beat healthy
  □ Attendre 15 min (ou trigger manuel avec .delay()) → task_15m exécutée
  □ volatility_snapshots : rows créées pour les 50 pairs configurés
  □ market_vi_snapshots : 1 row créée avec score + régime
  □ Si ≥ seuil pairs : watchlist_snapshots créée
  □ Vérifier logs Celery : pas d'exception, pas de tâche silencieusement échouée
```

### Dashboard Market VI

```
  □ Score s'affiche correctement (0.xx, badge couleur)
  □ Historique 24h visible (sparkline)
  □ Breakdown composantes : toggle indicateur OFF en settings → composante disparaît
  □ Info-bulle régime : s'affiche au hover
  □ Refresh automatique (polling ou WebSocket) → score se met à jour sans reload
```

### Watchlists UI

```
  □ Folders par date + TF correctement organisés
  □ Bouton "Afficher" → tableau inline s'expand
  □ Tableau 7 colonnes : Pair | VI | Régime | EMA Signal | 24h% | TF+1 | ⚠️
  □ TF+1 : valeur correcte (régime + score du TF supérieur)
  □ ⚠️ : ⚠️ affiché sur les EXTRÊME, ⛔ sur les MORT, vide sinon
  □ Bouton DL → fichier .txt téléchargé, format KRAKEN:XXXX.PM
  □ Filtre par TF fonctionne
```

### Sessions Trading + Live Prices

```
  □ TradingSessions dans Dashboard home : sessions correctes selon l'heure UTC actuelle
  □ London + NY overlap : correctement détecté sur la plage 12:00–16:00
  □ Weekend (tester manuellement en changeant la date système) :
      → badge "Weekend — Crypto only" affiché
      → sessions Forex affichées mais badgées inactives (pas cachées)
  □ Live Prices Banner : BTC + ETH + XAU s'affichent dans le header
  □ Refresh 30s : prix mis à jour sans reload page
  □ XAU : vérifier que la clé API n'est jamais exposée côté client (proxy backend)
```

### Risk × Volatility (formulaire trade)

```
  □ Ouvrir formulaire trade pour BTC 1h
  □ vi_multiplier info-bulle affichée sous le champ risk :
      "Market VI : ACTIF (0.68) → ×1.15 | Pair VI (BTCUSD 1h) : NORMAL (0.45) → ×1.00 → Risk : 1.38%"
  □ Modifier risk_base → risk_final se recalcule automatiquement
  □ Override manuel : utilisateur modifie la valeur → override pris en compte
  □ Pair VI : trigger on-demand → réponse < 3s
```

### Settings Volatility

```
  □ Modifier poids TFs (semaine) → Celery utilise les nouveaux poids au prochain run
  □ Modifier poids weekend → redistribution correcte samedi suivant
  □ Désactiver un indicateur (ex. MFI OFF) → composante absente du JSONB, vi_score recalculé
  □ Ajouter bot Telegram → bouton "Test" → message reçu sur mobile
  □ Modifier horaires 15m (ex. désactiver les nuits) → task skippée hors plage
  □ Sync Kraken pairs → nb pairs mis à jour affiché
  □ Retention : modifier 90j → 30j → anciens snapshots nettoyés par Celery task quotidienne
```

---

## 3. 🐛 Problèmes probables à anticiper

```
□ Kraken rate limiting : 1 req/s max sur les endpoints publics
    → Solution : semaphore Celery, sleep entre requêtes, queue de calcul par pair

□ TimescaleDB extension pas activée en prod
    → Solution : vérifier dans la migration : CREATE EXTENSION IF NOT EXISTS timescaledb;
    → Vérifier que l'image Docker PostgreSQL inclut TimescaleDB (timescale/timescaledb-ha)

□ Celery Beat vs multiple workers : Beat ne doit tourner qu'une seule instance
    → Solution : Dockerfile séparé pour beat vs worker, docker compose scale worker=2 beat=1

□ Weekend auto-détection : timezone UTC stricte
    → Solution : toujours utiliser datetime.utcnow() ou pendulum UTC, pas de datetime.now()

□ volatility_snapshots vide au premier run : TF+1 indisponible
    → Solution : si TF+1 pas encore calculé → afficher 'N/A' dans la colonne (pas d'erreur)

□ ETH/BTC (ETHXBT sur Kraken) : symbol différent des autres pairs
    → Solution : mapping explicite dans kraken_client.py, tester séparément

□ XAU API : clé expirée / rate limit
    → Solution : cache Redis 5 min, fallback sur dernière valeur connue avec timestamp

□ Watchlist vide quelques jours en démarrage (pas assez d'historique rolling 90j)
    → Solution : fallback percentile sur les données disponibles, minimum 7 jours requis
```

---

## 4. 📝 Documentation à mettre à jour après Phase 2

```
□ docs/architecture/tech/DATABASE.md
    → Ajouter les 5 nouvelles tables Phase 2 avec schéma complet

□ docs/architecture/tech/TECH_STACK.md
    → Mettre à jour : Redis / Celery / TimescaleDB / pandas-ta → "Phase 2 ✅"

□ docs/architecture/tech/CI_CD.md
    → Vérifier que le pipeline CI teste les nouveaux modules volatility

□ .github/copilot-instructions.md
    → Mettre à jour le statut : "Phase 2 COMPLETE" + résumé

□ docs/deployment/phases/phase2/implement-phase2.md
    → Marquer tous les steps ✅ DONE au fur et à mesure

□ custom/cheatsheet.md
    → Ajouter commandes Celery :
        make celery-worker     → démarrer le worker
        make celery-beat       → démarrer le beat
        make celery-purge      → vider la queue
        make celery-monitor    → Flower UI (optionnel)
```

---

## 5. 🚀 Déploiement prod Dell

### Prérequis prod

```
□ Image Docker PostgreSQL mise à jour : timescale/timescaledb-ha:pg16
  (remplace postgres:16 — inclut l'extension TimescaleDB)
□ Services à ajouter dans docker-compose.prod.yml :
    redis:
      image: redis:7-alpine
    celery-worker:
      build: .
      command: celery -A src.core.celery_app worker
    celery-beat:
      build: .
      command: celery -A src.core.celery_app beat
□ Variables d'environnement à ajouter dans .env.prod :
    REDIS_URL=redis://redis:6379/0
    XAU_API_KEY=...
    XAU_API_PROVIDER=metals_api  (ou twelve_data)
    KRAKEN_PUBLIC_API_URL=https://api.kraken.com/0/public
```

### Checklist déploiement

```
□ docker compose pull → nouvelles images tirées (notamment timescaledb)
□ Alembic migration Phase 2 appliquée :
    make prod-migrate  (ou ssh + docker exec)
□ Extension TimescaleDB active :
    SELECT * FROM timescaledb_information.hypertables;  → 2 tables
□ Celery worker + beat healthy :
    docker compose logs celery-worker  → "ready"
    docker compose logs celery-beat    → "Scheduler: Sending due task..."
□ Premier run Market VI attendu dans les 15 min après démarrage
□ Vérifier market_vi_snapshots alimentée côté prod :
    SELECT count(*) FROM market_vi_snapshots;  → > 0
□ Test alert Telegram depuis prod → message reçu
□ Live Prices Banner : BTC + ETH + XAU affichés en prod
□ Backup DB avant + après migration (script backup-db.sh)
```

### Rollback plan

```
Si la migration Phase 2 échoue en prod :
  1. Arrêter les nouveaux services (celery-worker, celery-beat, redis)
  2. make prod-rollback (alembic downgrade -1)
  3. Revenir à l'image postgres:16 (sans TimescaleDB)
  4. Vérifier que Phase 1 fonctionne toujours
  → Les nouvelles tables sont des ajouts exclusifs — Phase 1 n'en dépend pas
```

---

## 6. 📊 Phase 2 Self-Assessment (après 2–4 semaines d'usage réel)

```
□ Le Market VI est-il cohérent avec ce qu'on observe sur le marché ?
    → Si EXTRÊME mais marché calme → ajuster les seuils percentile

□ Les watchlists 15m sont-elles trop fréquentes / trop rarement générées ?
    → Ajuster le seuil VI minimum dans les settings

□ Le vi_multiplier génère-t-il des tailles de position raisonnables ?
    → EXTRÊME → ×0.70 est-il assez restrictif ou trop conservateur ?

□ L'EMA Score booste-t-il les bons setups en haut de watchlist ?
    → Vérifier sur 10 trades si les pairs boostés ont mieux performé

□ Les alertes Telegram sont-elles actionnables ?
    → Trop fréquentes → augmenter le cooldown
    → Trop rares → baisser le seuil VI minimum ou le régime déclencheur

□ Les horaires d'exécution sont-ils optimaux ?
    → Ex. les watchlists 15m du weekend 08:00–20:00 suffisent-elles ?

→ Écrire les notes dans : docs/phases/phase2/USER_FEEDBACK.md
```

---

## 7. 🔭 Ce qui vient après — Phase 3 preview

```
Phase 3 scope (Watchlist Generation avancée) :
  1. Monitoring 317 pairs en continu (pas juste les 50 du Market VI)
  2. OI/Volume + Funding Rate dans les watchlists (Kraken Futures API)
  3. Multi-EMA par TF (ex. EMA 50 + EMA 200 sur 4h)
  4. Paramétrage fin des périodes d'indicateurs
  5. Score de confluence multi-TF automatique (D14 — double-TF confirmation)
```
