# 📐 Phase 2 — Volatility Analysis Engine — Synthèse de réflexion

**Date :** 14 mars 2026
**Statut :** Draft v4 — feedback Mohamed intégré (14/03/2026)
**Sources :** Perplexity + ChatGPT + Grok — prompts envoyés le 13/03/2026

> Ce document synthétise les recommandations des 3 AIs + le feedback de Mohamed.
> Les décisions à prendre sont marquées **[DÉCISION]**.
> Les points ouverts nécessitant clarification sont marqués **[OPEN]**.

---

## 🏗️ Architecture globale — Clarification après feedback

Deux composants distincts, calculés par les mêmes Celery tasks :

| Composant | Scope | Calcul | Dashboard |
|-----------|-------|--------|-----------|
| **A) Market VI** | Score global du marché crypto, calculé à partir de la volatilité agrégée des ~50 pairs configurés | Chaque `tf_min` (ex. 5 min) | `/volatility/market` |
| **B) Per-Pair VI** | Tous les pairs Kraken actifs (317), calcul par TF selon la cadence de chaque TF | Cadencé par TF | `/volatility/pairs` |

Les deux alimentent le Risk Management via `GET /vi/current`.

---

### A) Market Volatility Index — Principe revu

**Pas** un score BTC-led avec ratios dominance uniquement.
→ **Score construit à partir de la volatilité moyenne des ~50 pairs configurés** — plus stable, plus représentatif qu'un seul BTC.

BTC reste le pair avec le poids le plus fort (configurable), mais le score agrège réellement les 50 pairs.

```
market_vi = weighted_avg(vi_score de chaque pair configuré)
            avec poids[BTC] configurable (défaut ~50%)
```

---

### B) Per-Pair Volatility — Watchlists par TF + trigger on-demand

#### Calcul cadencé par TF (watchlist automatique)

| TF | Cadence | Action si seuil atteint |
|----|---------|------------------------|
| **15m** | toutes les 15 min | Génère une watchlist 15m |
| **1h** | toutes les heures | Génère une watchlist 1h |
| **4h** | toutes les 4h | Génère une watchlist 4h |
| **1d** | 1 fois/jour (ex. 00:05) | Génère une watchlist daily |
| **1W** | 1 fois/semaine (lundi 01:00) | Génère une watchlist weekly |

Chaque watchlist = liste de pairs dont le VI dépasse le seuil configuré pour ce TF.

#### Trigger on-demand (Risk Management)

Quand l'utilisateur ouvre le formulaire de trade pour un pair sur un TF donné :
→ Calcul live du VI de ce pair sur ce TF
→ Score retourné instantanément
→ Utilisé pour ajuster le risk proposé

✅ **Les deux** : watchlists stockées en DB (historique consultable) + affichage live du dernier snapshot par TF.
Retention configurable en settings (ex. 30j / 90j / 6 mois) — nettoyage automatique via Celery task quotidienne.

---

## 1. Indicateurs — Décision

### ✅ Recommandation retenue (consensus 3 AIs)

**OBV seul = écarté.** Trop directionnel, sensible aux spikes isolés.

Indicateurs core retenus (5) :

| # | Indicateur | Catégorie | Rôle |
|---|-----------|-----------|------|
| 1 | **RVOL** (Relative Volume) = vol_current / vol_avg(20-50 périodes) | Volume | Détecteur "actif vs mort" — le plus direct |
| 2 | **MFI** (Money Flow Index) ou Chaikin Money Flow | Volume + Prix | Volume avec confirmation de prix — sans direction pure |
| 3 | **ATR normalisé** (14 périodes) | Prix | Intensité des mouvements — indispensable même si prix-pur |
| 4 | **Bollinger Band Width** (écart relatif) | Prix | Squeeze detection + régime bas/haute volatilité |
| 5 | **Orderbook Depth proxy** = top 10 levels bid/ask via Kraken `/depth` | Liquidité | Signal liquidité temps-réel, gratuit sur Kraken |

### ⚠️ Clarification importante — Ce que le VI score produit

Le VI ne détecte **pas** un signal de scalp. Il définit **dans quel régime de marché on se trouve**, et ce régime oriente le **style de trading recommandé** :

| Régime VI | Interprétation | Style recommandé |
|-----------|---------------|-----------------|
| MORT (< 30e pct) | Marché peu liquide, spreads larges | Éviter / réduire size fortement |
| NORMAL (30-60e pct) | Conditions standard | Swing / Position classique |
| ACTIF (60-80e pct) | Bonne liquidité, bons mouvements | Day trading / Scalping possible |
| EXTRÊME (> 80e pct) | Sur-volatilité, bruit, slippage | Réduire size ou s'abstenir |

→ L'UI affiche ce régime + le style recommandé, pas un "signal" directionnel.

✅ **Validé** — partir sur ces 5 pour Phase 2. Chaque indicateur sera **activable/désactivable depuis les settings** (toggle par indicateur). Des tests pourront être faits pendant l'implémentation pour affiner.

---

## 2. Fréquence de calcul et TFs — Décision

### ✅ Structure multi-TF retenue (avec 1D inclus)

| TF | Calcul cadencé | Poids dans score agrégé | Notes |
|----|---------------|------------------------|-------|
| **15m** (LTF) | toutes les 15 min | 25% | Court terme — 40% c'était trop dominant |
| **1h** (MTF) | toutes les heures | 40% | Day trading — TF central |
| **4h** (HTF) | toutes les 4h | 25% | Position / swing |
| **1d** (HTF2) | 1 fois/jour | 10% | Contexte macro daily |

**Score agrégé final = 25% × VI_15m + 40% × VI_1h + 25% × VI_4h + 10% × VI_1d**

> **Pas de 1W dans l'agrégation** — le 1W est trop lent pour influencer un score temps-réel. Le contexte weekly est couvert par la Market Analysis manuelle.

### ⚠️ Gestion du weekend

Le crypto trade 24/7 mais la volatilité en weekend est structurellement différente (moins de volume, pas d'institutionnels, 1D basé sur données partielles).

Règle retenue :
```
Si weekend (samedi/dimanche) :
  - Ne pas inclure le TF 1D dans l'agrégation (données incomplètes)
  - Redistribuer son poids : 50% LTF + 40% MTF + 10% HTF
    (crypto en weekend = mouvements courts, LTF plus pertinent)
```

→ **Auto-détection obligatoire** (pas de toggle manuel). Le système détecte le jour via l'horodatage UTC et redistribue automatiquement.

**Poids weekend configurables en settings** (sliders indépendants des poids semaine), avec contrainte `sum = 100%`.

✅ **Poids 25/40/25/10 validé (semaine). Weekend = auto-détection avec redistribution 50/40/10 — configurable.**

---

## 3. Stockage — Architecture clarifiée

### Ce qui est stocké vs ce qui est calculé en live

| Donnée | Stockage | Fréquence | Pourquoi |
|--------|---------|-----------|----------|
| **VI score par pair par TF** (50 pairs market) | ✅ DB — `volatility_snapshots` | toutes les 5 min | Nécessaire pour calculer le Market VI agrégé + historique |
| **Market VI global** | ✅ DB — `market_vi_snapshots` | toutes les 5 min | Dashboard historique + alerting |
| **Watchlists par TF** | ✅ DB — `watchlist_snapshots` | cadencée par TF | Historique consultable + alerting |
| **VI on-demand (trigger trade)** | ❌ mémoire uniquement | live | Calcul ponctuel, pas besoin d'historique |

### Volume réel

```
50 pairs market × 1 score/5min × 288 calculs/jour = 14 400 rows/jour (volatility_snapshots)
+ market_vi global : 288 rows/jour
+ watchlists : ~10 rows/jour (une par TF par trigger)
Total ≈ 15 000 rows/jour — TimescaleDB justifié dès le départ pour la robustesse
```

### ✅ Décision : TimescaleDB dès Phase 2

User acté : **partir sur TimescaleDB directement** pour avoir un truc robuste dès le début.
- `volatility_snapshots` → hypertable sur `timestamp`
- `market_vi_snapshots` → hypertable sur `timestamp`
- Retention policies gérées nativement par TimescaleDB (pas de pg_cron)
- Compression automatique des données > 30 jours

### 317 pairs Kraken — Synchronisation dynamique

**Les 317 pairs ne sont pas hardcodés.** Ils sont récupérés dynamiquement depuis l'API Kraken :

```python
# Celery task de sync — 1 fois par jour (ou on-demand depuis les settings)
def sync_kraken_pairs():
    pairs = kraken.fetch_all_perpetual_pairs()  # GET /instruments
    upsert_into_db(pairs)  # met à jour la table instruments
```

→ Le multi-select "Pairs monitored" dans les settings se base sur cette table synchronisée.
→ Idem pour les 50 pairs du Market VI : sélection parmi les pairs Kraken connus en DB.

---

### JSONB vs colonnes séparées — Explication

**Colonnes séparées** (ex. `rvol DECIMAL(5,3), mfi DECIMAL(5,3), atr_norm DECIMAL(5,3)...`) :
- ✅ Queries SQL lisibles : `WHERE rvol > 1.5 AND atr_norm > 0.7`
- ✅ Type-safe, indexes possibles sur chaque composante
- ❌ Chaque ajout/suppression d'indicateur = migration Alembic + colonne nullable
- ❌ **Trop rigide pour la scalabilité** : activer/désactiver un indicateur depuis les settings devient un problème de schema

**JSONB** (ex. `components = {"rvol": 0.72, "mfi": 0.58, ...}`) :
- ✅ Flexible : ajouter/retirer un indicateur **sans aucune migration**
- ✅ PostgreSQL le supporte nativement avec index GIN et opérateurs JSON
- ✅ Requêtable : `WHERE (components->>'rvol')::float > 1.5`
- ✅ **Si un indicateur est désactivé → son champ est simplement absent du JSONB, aucun impact sur la structure de calcul des autres**
- ❌ Un peu moins lisible, moins type-safe

### ✅ Scalabilité add/disable indicateur

Le choix JSONB répond directement au besoin de scalabilité :
- **Ajouter un indicateur** → ajouter sa clé dans le JSONB lors du calcul → zéro migration
- **Désactiver un indicateur** → le retirer du calcul → clé absente du JSONB → `vi_score` recalculé sur les indicateurs actifs uniquement
- **La formule de calcul du `vi_score`** est normalisée dynamiquement sur les indicateurs actifs (weighted avg) → pas d'impact sur le score si certains sont off

```python
# Calcul dynamique selon indicateurs actifs
def compute_vi(components: dict, weights: dict) -> float:
    active = {k: v for k, v in components.items() if k in weights}
    total_weight = sum(weights[k] for k in active)
    return sum(v * weights[k] / total_weight for k, v in active.items())
```

**Recommandation pour Phase 2** : `vi_score` en colonne DECIMAL (pour indexer et requêter vite), `components` en JSONB (pour stocker le breakdown sans migration à chaque itération).

```sql
volatility_snapshots (
    pair        VARCHAR(20),
    timeframe   VARCHAR(10),
    vi_score    DECIMAL(5,3),     -- indexable, requêtable directement
    components  JSONB,            -- {"rvol": 0.72, "mfi": 0.58, "atr": 0.61, ...}
    timestamp   TIMESTAMP,
    PRIMARY KEY (pair, timeframe, timestamp)
)
```

✅ **Validé** — `vi_score` colonne DECIMAL (indexable), `components` JSONB (flexible). Pas de colonnes séparées par indicateur — la scalabilité l'exige.

---

## 4. BTC comme pilier central — Décision

### Pourquoi BTC est central (et pas juste un pair parmi d'autres)

BTC capte 50-60% de la capitalisation crypto. Quand BTC est volatile → tout le marché l'est. Quand BTC squeeze → les alts suivent quelques minutes après. C'est un **leading indicator** de régime pour l'ensemble du marché.

**Usage dans le Market VI** : donner plus de poids à BTC dans le calcul du score global.

### ✅ Poids BTC retenu

**50 % configurable** (pas 65 % — trop dominant).

→ Configurable en DB settings : `btc_weight` (défaut 0.50, modifiable en UI).

Le reste des 50 % distribué parmi les autres pairs configurés proportionnellement.

### Ratios secondaires — Que retenir ?

**Question soulevée :** est-ce que ETH/BTC, BTC.D, OTHERS.D sont encore pertinents sachant qu'on a déjà une Market Analysis (MA) pour le contexte macro ?

**Réponse :** La MA est **manuelle et hebdomadaire**. Le Market VI est **automatique et temps-réel**. Ils ne font pas le même travail.

| Signal | MA (Manuel) | Market VI (Auto) |
|--------|-------------|-----------------|
| BTC bias directionnel | ✅ | ❌ (pas directionnel) |
| ETH/BTC relative strength | ✅ (analyse manuelle) | ✅ si inclus dans les 50 pairs |
| Volatilité temps-réel | ❌ (snapshot hebdo) | ✅ |
| Dominance BTC proxy | ❌ | ✅ via volume proxy |
### ⚠️ Problème : les instruments récupérés sont USD-only

Les pairs Kraken récupérés via l'API sont des paires `/USD` (ex. `BTCUSD`, `ETHUSD`). **ETH/BTC n'est donc pas dans le scope natif** du Market VI.

**Question :** Est-il pertinent de récupérer ETH/BTC séparément ?

**Oui, clairement :**
- Le ratio ETH/BTC est un indicateur de **relative strength** entre les deux leaders
- Il signal les rotations de capital : BTC → ETH → Alts
- C'est un signal de contexte macro que la MA n'a pas en temps réel

**Solution :** Ajouter un scope spécial "paires croisées" (cross pairs) configurables à part :
- `ETHBTC` récupéré depuis Kraken (existe nativement)
- Traité **séparément** du Market VI USD (pas dans l'agrégation pondérée)
- Affiché comme **indicateur contextuel** dans le dashboard Market VI : ETH/BTC trend (above/below EMA) → info de contexte, pas un composant du vi_score

**[OPEN D16]** Scope initial : ETH/BTC uniquement, ou BTC/USDT + ETH/BTC ? À décider à l'implémentation.
**Recommandation :** Ne pas dupliquer l'analyse de dominance dans le VI. Le proxy Kraken-native est suffisant comme pondération interne :

```python
# Utilisé pour pondérer BTC dans le score global, pas comme indicateur à part
btc_volume_weight = btc_24h_volume / sum(all_configured_pairs_24h_volume)
```

`OTHERS.D` et `TOTAL2/TOTAL` → **écarté** du VI (c'est du territoire MA).

✅ **Validé** — 50% BTC configurable. Proxy Kraken-native suffisant (pas de dépendance externe).

---

## 5. Seuils et calibration — Décision

### ✅ 5 régimes retenus (séparation de "ACTIF" en 2 niveaux)

User validé : **séparer ACTIF** pour plus de granularité dans les décisions de style.
Chaque régime a un **code couleur** affiché dans l'UI (info-bulles incluses), **tous les seuils sont paramétrables** en settings.

> ⚠️ **Emojis** : utilisés comme identifiants visuels neutres dans le code (ex. dans les filtres/configs), mais **pas affichés en début de ligne dans l'UI** — le nom du régime + la couleur suffisent. L'emoji peut être optionnel/configurable.

| Régime | Couleur | Condition (défaut) | VI range (exemple) | Interprétation | Style recommandé |
|--------|---------|-------------------|-------------------|----------------|------------------|
| **MORT** | `#6b7280` gris | < 20e percentile | 0.00 – 0.22 | Liquidité très faible, spreads larges, wash trading | Éviter — ne pas trader |
| **CALME** | `#3b82f6` bleu | 20e – 45e percentile | 0.22 – 0.45 | Volume bas, consolidation possible | Swing/Position si setup clair |
| **NORMAL** | `#22c55e` vert | 45e – 65e percentile | 0.45 – 0.63 | Conditions équilibrées, bonne liquidité | Day trading / Swing |
| **ACTIF** | `#f59e0b` orange | 65e – 82e percentile | 0.63 – 0.80 | Volume élevé, bons mouvements directionnels | Scalp / Day trading optimal |
| **EXTRÊME** | `#ef4444` rouge | > 82e percentile | 0.80 – 1.00 | Sur-volatilité, bruit, slippage, liquidations en cascade | Réduire size fortement ou s'abstenir |

> **Tous les percentiles seuils sont modifiables en settings** (20/45/65/82 par défaut).
> L'UI affiche une **info-bulle par régime** expliquant l'interprétation et le style recommandé.
> Le **VI range en valeur absolue** (ex. `0.63 – 0.80`) est calculé et affiché dynamiquement à partir de l'historique rolling — donne plus de précision que juste le pourcentage.

### Règle d'utilisation des emojis dans l'UI

| Contexte | Règle |
|----------|-------|
| Prefix label régime dans tables/boards | ❌ **Pas d'emoji** — couleur CSS + nom uniquement (ex. badge `ACTIF` en orange) |
| Colonne alerte / signal d'attention | ✅ **Emoji sémantique** : `⚠️` proche EXTRÊME, `⛔` MORT, `✅` NORMAL/ACTIF optimal |
| Messages Telegram | ✅ **Libre** — pas de CSS, emojis = seul levier visuel |
| Boutons / badges UI | ✅ OK si badge coloré sans emoji prefix |

> **Règle résumée :** emojis = signal sémantique (attention / interdit / ok). Pas décoration de label.

---

### Rolling 90 jours vs 30 jours — Exemple concret

**Ce que ça veut dire :**
À chaque recalcul quotidien, le système prend les VI scores des N derniers jours et calcule les percentiles 30/60/80 sur cette fenêtre.

**Exemple BTC en 2 contextes :**

#### Fenêtre 90 jours (recommandée)
```
Contexte : on sort d'un bull run de 90j très volatile (vi_scores hauts)
vi_score aujourd'hui = 0.65

Percentile 80e sur 90j = 0.80 (parce que les 90j précédents étaient très actifs)
→ 0.65 < 0.80 → classé NORMAL

→ Le système reconnaît que 0.65 est "moyen" par rapport à l'environnement récent
```

#### Fenêtre 30 jours (plus réactif, moins stable)
```
Même situation : les 30 derniers jours récents ont été calmes
Percentile 80e sur 30j = 0.55 (la barre est plus basse)
→ 0.65 > 0.55 → classé EXTRÊME

→ Le même score est classé différemment selon la fenêtre
```

**Lequel choisir ?**
- **90 jours** = plus de mémoire, plus stable, moins de faux régimes "extrêmes"
- **30 jours** = plus réactif, adapté si le marché change vite de régime

→ **90 jours par défaut, configurable en UI (30 / 60 / 90 jours).** ✅ Validé par Mohamed.

---

## 6. vi_multiplier — Interaction Risk Management

### ⏸️ Implémentation déférée — Réflexion en cours

Le vi_multiplier sera traité dans le détail lors de la phase d'intégration Risk × Volatility.

### Ce qui est acté conceptuellement

Le risk engine utilise **deux VI** :
1. **Market VI** — contexte global du marché (macro)
2. **Pair VI** — volatilité spécifique du pair sur le TF choisi

```
risk_ajusté = risk_base × f(market_vi, pair_vi)
lot_size = risk_ajusté / abs(entry - sl)
```

**Affichage dans le formulaire de trade :**
L'UI doit montrer au-dessus/dessous du champ risk :
```
ℹ️ Risk ajusté par la volatilité
  Market VI : ACTIF (0.68) → ×1.15
  Pair VI (BTC 1h) : NORMAL (0.45) → ×1.00
  → Risk final : 1.38% (au lieu de 1.20% de base)
```

→ L'utilisateur comprend **pourquoi** le risk change, et peut override manuellement.

**[OPEN D9]** Piecewise (4 paliers) ou sigmoid (fonction continue) ? À challenger quand on implémente.

> Le bon équilibre est clé : le multiplicateur doit **amplifier sans sur-corriger**.
> Une approche raisonnable : piecewise simple, 3 paliers par composante (CALME → ×0.85, NORMAL → ×1.00, ACTIF → ×1.15, EXTRÊME → ×0.80 reduire). Testable dès l'implémentation.

---

## 7. Alerting Telegram — Décision

### Architecture settings Telegram

Route dédiée : `GET/PUT /settings/notifications`

#### Section "Bots Telegram" (configurable)
Possibilité de configurer **plusieurs bots** (ex. 1 pour Market VI, 1 pour watchlists) :

| Champ | Description |
|-------|-------------|
| `bot_token` | Token HTTP de l'API Telegram (format `123456:ABC-DEF...`) |
| `chat_id` | ID du chat / channel cible |
| `bot_name` | Nom libre (ex. "ATD Market Bot") pour identifier dans l'UI |

→ Interface : liste de bots, ajout/suppression, test de connexion (bouton "Envoyer un message test").

#### Section "Volatilité Marché" (Market VI)
| Paramètre | Type | Description |
|-----------|------|-------------|
| Activé | Toggle | On/Off pour tous les alerts Market VI |
| Bot cible | Select | Choisir parmi les bots configurés |
| Fréquence | Select | 15min / 30min / 1h / 2h max entre alertes (cooldown) |
| Seuil alerte | Régime | Alerter si passage vers ACTIF / EXTRÊME / MORT (à cocher) |

#### Section "Volatilité Pairs / Watchlists"
| Paramètre | Type | Description |
|-----------|------|-------------|
| Activé | Toggle | On/Off global |
| Bot cible | Select | Bot dédié watchlists (parmi les bots configurés) |
| Par TF (15m / 1h / 4h / 1d) | Toggle individuel | Activer/désactiver les alertes par TF |
| Fréquence / cooldown par TF | Select | Ex. max 1 alerte/heure pour 15m, 1/4h pour 1h... |
| **Seuil VI min** par TF | Slider 0–1 | Paire incluse dans watchlist si VI ≥ ce seuil |
| **Plages VI** par TF | Ranges | Paires groupées par régime dans la watchlist (ex. ACTIF + EXTRÊME seulement) |
| Seuil min pairs déclencheurs | Number | N'alerter que si ≥ N pairs dans la watchlist |

**Format du message Telegram watchlist :**
```
🔥 ATD Watchlist — 1H (14/03 15:00 UTC)
Régime marché : ACTIF (0.71) | BTC: 0.73 | ETH/BTC: ↘ (0.84x)

EXTRÊME (> 0.80)
  • PF_ETHUSDT  0.89  EMA: breakout+retest ↑  24h:+4.2%
  • PF_SOLUSDT  0.85  EMA: above 200 ↑        24h:+2.8%

ACTIF (0.63–0.80)
  • PF_AVAXUSDT 0.74  EMA: below 200 ↓        24h:+1.1%
  • PF_DOTUSDT  0.67  EMA: neutral →           24h:-0.3%

→ 4 pairs | 50 monitored | EMA boost: 2 pairs ↑
Conclusion: marché actif, rotations ETH+SOL en tête — favoriser LTF sur breakouts confirmés
```

> Le message Telegram inclut :
> - Régime global + score BTC + ETH/BTC context
> - VI score par pair + signal EMA (voir section EMA Score)
> - Variation 24h
> - Comptage et conclusion actionnable (pas juste une liste brute)

✅ **Multi-bots validé** — chaque bot a un rôle précis :
- Bot 1 : Market VI (score global + régime)
- Bot 2 : Watchlists per-pair (par TF)
- (Extensible : 1 bot par TF si souhaité)

**[OPEN D14]** Double-TF confirmation pour les alerts paires ? À challenger à l'implémentation.

---

## 8. TimescaleDB vs PostgreSQL vanilla — Décision révisée

✅ **TimescaleDB dès Phase 2** — voir section 3 (stockage) pour les détails et le recalcul de volume.

Résumé : ~15k rows/jour avec 50 pairs monitored + market VI + watchlists → TimescaleDB gère ça facilement et apporte retention policies + compression natives sans pg_cron.

---

## 9. Settings configurables — Structure révisée

### Routes settings Phase 2

| Route | Contenu |
|-------|---------|
| `GET/PUT /settings/volatility` | Config Market VI + Per-Pair VI |
| `GET/PUT /settings/notifications` | Bots Telegram + alertes (voir section 7) |

### `/settings/volatility` — Contenu

#### Market VI
| Paramètre | Type | Défaut |
|-----------|------|--------|
| Poids BTC | Slider 0-100% | 50% |
| TFs actifs | Toggles (15m / 1h / 4h / 1d) | Tous actifs |
| Poids par TF | Sliders (sum = 100%) | 25/40/25/10 |
| Poids weekend par TF | Sliders indépendants (sum = 100%) | 50/40/10/0 |
| Weekend mode | Toggle | Auto (désactive 1d + rédistribue) |
| Rolling window | Select (30j / 60j / 90j) | 90j |
| Fréquence refresh | Select (5min / 15min / 1h) | 15min |

#### Per-Pair VI
| Paramètre | Type | Défaut |
|-----------|------|--------|
| **Pairs Market VI** | Multi-select (parmi les pairs Kraken en DB, synchro dynamique) | 50 pairs défaut (top volume) |
| **Pairs watchlist** | Multi-select (parmi les 317 Kraken synchronisés) | = Pairs Market VI par défaut |
| TFs à calculer | Toggles 15m / 1h / 4h / 1d | Tous actifs |
| Indicateurs actifs | Toggles par indicateur (RVOL / MFI / ATR / BB Width / Depth) | Tous actifs |
| Seuil watchlist par TF | Slider 0–1 + plages par régime | 0.65 défaut |
| **Horaires d'exécution par TF** | Config heures (HH:MM) + jours | Voir détail ci-dessous |
| Retention snapshots | Select (1 mois / 3 mois / 6 mois) | 3 mois |
| Retention watchlists | Select (7j / 30j / 90j) | 30j |
| **Sync Kraken pairs** | Bouton "Synchroniser les pairs Kraken" (+ dernière sync date) | — |
| **Poids weekend** | Sliders LTF/MTF/HTF (sum = 100%) | 50% / 40% / 10% |

> **Les 317 pairs Kraken sont récupérés dynamiquement** depuis l'API Kraken (task de sync via Celery ou bouton manuel en settings). Ce n'est jamais hardcodé.

#### Config horaires d'exécution (Watchlists)

Chaque TF peut être activé/désactivé et planifié selon les préférences :

| TF | Config disponible | Exemple |
|----|-------------------|--------|
| **15m** | Plages horaires actives (ex. 06:00–22:00) + jours | Weekend: 08:00–20:00 uniquement |
| **1h** | Plages horaires actives + jours | Weekend: toujours actif |
| **4h** | Heures fixes (ex. 00:05 / 04:05 ...) + jours | Tous les jours |
| **1d** | Heure fixe (ex. 00:05) + jours actifs | Lun-Ven seulement si souhaité |

→ Exemple concret (configuration weekend type) :
```
15m → actif SAM+DIM, plage 08:00–20:00 UTC (évite les heures mortes)
1h  → actif SAM+DIM, toute la journée
4h  → actif SAM+DIM, idem
1d  → désactivé SAM+DIM (données partielles)
```

**Écarté pour Phase 2 :** paramétrage fin des périodes par indicateur → presets uniquement.

✅ **Structure validée par Mohamed.**

---

## 10. Architecture technique — Synthèse révisée

### Stack Phase 2 (ajouts par rapport à Phase 1)

| Ajout | Justification |
|-------|--------------|
| **Celery + Redis** | Tasks périodiques par TF + trigger on-demand |
| **python-kraken-sdk** ou REST direct | Fetch OHLCV (bougies) + orderbook depth |
| **pandas-ta** | Calcul RVOL / MFI / ATR / BB Width en Python (simple, pas de dépendance C) |
| **TimescaleDB** (extension PostgreSQL) | Time-series robuste dès Phase 2 — retention + compression natifs |

### Celery tasks — Structure

```python
# Task 15m (via celery beat)
@app.task
def compute_15m_volatility():
    pairs = get_monitored_pairs()
    for pair in pairs:
        ohlcv = kraken.fetch_ohlcv(pair, '15')  # Kraken API : interval en minutes
        vi = compute_vi(ohlcv, pair, '15m')
        save_snapshot(pair, '15m', vi)
    recompute_market_vi()
    check_watchlist_alerts('15m')

# Idem pour 1h, 4h, 1d, 1W — schedules différents via Celery Beat

# Trigger on-demand depuis le Risk Engine
@app.task
def compute_pair_vi_live(pair: str, timeframe: str) -> float:
    ohlcv = kraken.fetch_ohlcv(pair, timeframe)
    return compute_vi(ohlcv, pair, timeframe).vi_score  # retourné, non stocké
```

### Nouveaux endpoints Phase 2

| Route | Méthode | Role |
|-------|---------|------|
| `GET /vi/market` | GET | Score Market VI actuel + historique + régime |
| `GET /vi/pairs` | GET | Dashboard per-pair ranking (derniers snapshots) |
| `GET /vi/pair/{pair}/{tf}` | GET | VI on-demand d'un pair sur un TF (live trigger) |
| `GET /vi/watchlist/{tf}` | GET | Dernière watchlist générée pour un TF |
| `GET/PUT /settings/volatility` | GET/PUT | Configuration complète |
| `GET/PUT /settings/notifications` | GET/PUT | Bots Telegram + alertes |

---
```

### Nouveaux endpoints Phase 2

| Route | Méthode | Role |
|-------|---------|------|
| `GET /vi/market` | GET | Score Market VI actuel + historique + régime |
| `GET /vi/pairs` | GET | Dashboard per-pair ranking (derniers snapshots) |
| `GET /vi/pair/{pair}/{tf}` | GET | VI on-demand d'un pair sur un TF (live trigger) |
| `GET /vi/watchlist/{tf}` | GET | Dernière watchlist générée pour un TF |
| `GET/PUT /settings/volatility` | GET/PUT | Configuration complète |
| `GET/PUT /settings/notifications` | GET/PUT | Bots Telegram + alertes |

---

## 🗓️ Sessions de trading + Live Prices Banner

### A) Composant TradingSessions

Afficher les **sessions de trading actives** dans le Dashboard home.

#### Sessions à afficher

| Session | Horaires UTC | Jours actifs |
|---------|-------------|-------------|
| **Asia** | 00:00 – 09:00 | Lun-Ven |
| **London** | 07:00 – 16:00 | Lun-Ven |
| **New York** | 12:00 – 21:00 | Lun-Ven |
| **NYSE Open** | 14:30 – 15:30 | Lun-Ven |
| **Overlap London/NY** | 12:00 – 16:00 | Lun-Ven |

**Weekend :** afficher un **badge distinct** (ex. `🌙 Weekend — Crypto only`) **mais laisser les sessions Forex visibles** (grised/inactives) — pas de disable, juste un badge de contexte. L'utilisateur voit que Asia/London/NY ne sont pas actives sans les cacher.

#### Implémentation

- Calcul côté **frontend** (heure UTC current → check plages) : zéro round-trip API
- Composant `TradingSessions` dans le **Dashboard home** (pas dans le header — trop encombré)
- Un widget **volatilité** adjacent : dernier Market VI + régime + tendance

✅ **D15 Validé** — Frontend, Dashboard home, sessions toujours affichées en weekend (badgées).

---

### B) Live Prices Banner

**Demande :** Récupérer et afficher les prix en temps réel des assets de référence dans la bannière header :

| Asset | Source | |
|-------|--------|--|
| **BTC** | Kraken WebSocket ou REST poll | Prix + % 24h change |
| **ETH** | Kraken WebSocket ou REST poll | Prix + % 24h change |
| **XAU (Gold)** | API tierce (ex. Metals-API, Open Exchange Rates, Twelve Data) | Prix + % 24h change |

```
BTC  ~65,420  +1.4%  |  ETH  ~3,210  -0.3%  |  XAU  ~2,340  +0.7%
```

#### Implémentation

- **BTC + ETH :** Kraken REST `GET /Ticker?pair=XBTUSD,ETHUSD` → poll toutes les 30s (pas de WebSocket en Phase 2)
- **XAU :** API tierce configurable — backend endpoint proxy `/api/prices/xau` (évite d'exposer l'API key en frontend)
- Config en settings (token API, activer/désactiver chaque asset, intervalle de refresh)
- Composant `LivePricesBanner` dans le header (ticker scrollant ou lignes fixes)

**[OPEN D17]** Quelle API pour XAU ? Options : Metals-API (freemium), Twelve Data (freemium), Alpha Vantage (gratuit limité). À confirmer.

---

## 🔢 EMA Score — Boost VI (Nouvelle fonctionnalité Phase 2)

### Concept

Chaque TF a une **EMA de référence** configurable :

| TF | EMA référence défaut |
|----|---------------------|
| 15m | EMA 50 |
| 1h | EMA 100 |
| 4h | EMA 200 |
| 1d | EMA 200 |

Pour chaque pair calculé, le système analyse la **position du prix par rapport à cette EMA** et en déduit un **EMA Score (0–100)** :

> ⚠️ **Le breakout peut être dans les deux sens** — un breakdown+retest baissier est tout aussi exploitable (short). L'EMA Score est direction-agnostique : il mesure la **conviction du setup**, pas la direction. C'est le signal label (↑ ou ↓) qui indique le biais.

| Configuration prix/EMA | Signal | EMA Score | Boost ranking |
|------------------------|--------|-----------|---------------|
| Breakout au-dessus + retest confirmé | `↑ breakout+retest` | 100 | ✅ +1 niveau régime |
| Breakdown en-dessous + retest confirmé | `↓ breakdown+retest` | 100 | ✅ +1 niveau régime (short setup) |
| Au-dessus de l'EMA clairement (>1%) | `↑ above EMA` | 75 | ✅ boost partiel |
| En-dessous de l'EMA clairement (<-1%) | `↓ below EMA` | 25 | ❌ neutre |
| Autour de l'EMA (±1%) | `→ neutral` | 50 | ❌ neutre |

### Fonctionnement

1. EMA calculée via `pandas-ta` sur les données OHLCV
2. `ema_score` calculé selon la position relative du prix
3. Le `ema_score` **et le signal** (`ema_signal`) sont stockés dans le JSONB `components`
4. Si `ema_score >= 75` : le pair est **boosté** dans le ranking (remonté en haut du groupe régime) — que ce soit un breakout haussier ou un breakdown baissier
5. L'UI/Telegram affiche le signal : `↑ breakout+retest` / `↓ breakdown+retest` / `↑ above EMA` / `↓ below EMA` / `→ neutral`

### Intégration dans le score global

L'EMA Score **n'entre pas directement dans le vi_score** (qui reste basé sur RVOL/MFI/ATR/BB/Depth).
Il agit comme un **boost de ranking** dans la watchlist et un **signal d'information complémentaire** affiché à côté.

```python
# Ranking final de la watchlist
# Tri : vi_score DESC, puis ema_score DESC (pour les paires ex-aequo)
sorted_watchlist = sorted(pairs, key=lambda p: (p.vi_score, p.ema_score), reverse=True)
```

**La période EMA par TF est configurable en settings.** Possibilité d'en avoir plusieurs (ex. EMA 50 + EMA 200 sur 4h) — Phase 3 scope.

✅ **Nouveau** — EMA Score en Phase 2 comme boost watchlist + indicateur contextuel.

---

## 🎯 Tableau des décisions — État actuel

| # | Décision | Statut | Retenu / À valider |
|---|---------|--------|--------------------|

| D1 | Indicateurs core | ✅ Validé | RVOL + MFI + ATR + BB Width + Depth — on/off depuis settings |
| D2 | TFs + poids | ✅ Validé | 25/40/25/10 — pas de 1W dans l'agrégation |
| D3 | Weekend logic | ✅ Validé | Auto-détection — redistribution automatique — poids weekend 50/40/10 configurable |
| D4 | JSONB components + scalabilité | ✅ Validé | vi_score colonne + components JSONB — add/disable indicateur sans migration |
| D5 | Stockage + TimescaleDB | ✅ Validé | TimescaleDB dès Phase 2 |
| D6 | BTC weight | ✅ Validé | 50% configurable, proxy Kraken-native |
| D7 | Rolling window | ✅ Validé | 90j défaut, configurable 30/60/90j |
| D8 | 5 régimes couleurs + range VI | ✅ Validé | MORT/CALME/NORMAL/ACTIF/EXTRÊME — tous paramétrables — VI range absolu affiché |
| D9 | vi_multiplier forme | **[OPEN]** | Piecewise 3 paliers pressenti — déféré à l'implémentation Risk × Vol |
| D10 | Telegram multi-bots | ✅ Validé | Bot Market VI + Bot Watchlists (extensible) |
| D11 | Watchlist Telegram enrichi | ✅ Validé | VI score + EMA signal + 24h change + conclusion actionnable |
| D12 | Watchlists stockées en DB | ✅ Validé | DB + live + retention configurable |
| D13 | 317 pairs dynamiques Kraken | ✅ Validé | Sync task Celery quotidienne + bouton manuel |
| D14 | Double-TF confirmation alerts | **[OPEN]** | À challenger à l'implémentation |
| D15 | Sessions dashboard | ✅ Validé | Frontend, Dashboard home, sessions badgées en weekend (pas cachées) |
| D16 | ETH/BTC cross pair | **[OPEN]** | Récup à part + indicateur contextuel — scope initial : ETH/BTC only |
| D17 | Live Prices Banner (XAU source) | **[OPEN]** | Metals-API / Twelve Data / Alpha Vantage — à confirmer |
| D18 | EMA Score boost watchlist | ✅ Validé | EMA référence par TF — boost ranking, pas dans vi_score — période configurable |
| D19 | Horaires exécution watchlists | ✅ Validé | Config plages horaires + jours par TF — ex. 15m actif SAM/DIM 08-20 UTC seulement |
| D20 | Watchlist UI (format + DL) | ✅ Validé | Folders date/TF, DL format TradingView, nom `dec2821h_Perps_15m_v14_USD_KRAKEN` |

---

## 📋 Watchlist UI — Spécification

### Affichage en liste (Dashboard Watchlists)

Chaque watchlist générée est affichée **sur une seule ligne**, organisée sous des **folders** :

```
📁 2025-12-28
  📁 15m
    dec2821h_Perps_15m_v14_USD_KRAKEN   [ACTIF]  12 pairs  21:04  👁  ⬇️
    dec2800h_Perps_15m_v13_USD_KRAKEN   [NORMAL]  8 pairs  00:04  👁  ⬇️
  📁 1h
    dec2821h_Perps_1h_v14_USD_KRAKEN    [ACTIF]   9 pairs  21:02  👁  ⬇️
📁 2025-12-27
  ...
```

Chaque ligne affiche :
- Nom de la watchlist (syntaxe `{date}{heure}_Perps_{TF}_v{n}_{quote}_{exchange}`)
- Régime dominant (badge couleur)
- Nombre de pairs
- Heure de génération
- [👁] Bouton "Afficher" — ouvre la watchlist inline (expandable row)
- [⬇️] Bouton DL — télécharge au format TradingView

### Format TradingView (download)

```
KRAKEN:CTSIUSD.PM
KRAKEN:TRXUSD.PM
KRAKEN:PONKEUSD.PM
KRAKEN:AEVOUSD.PM
KRAKEN:DYMUSD.PM
```

### Contenu watchlist inline (affichage)

La watchlist inline affiche un tableau **minimum actionnable** :

| Pair | VI Score | Régime | EMA Signal | 24h % | TF+1 | ⚠️ |
|------|----------|--------|------------|-------|------|-----|
| CTSIUSD | 0.82 | EXTRÊME | ↑ breakout+retest | +4.2% | ACTIF · 0.71 | ⚠️ |
| TRXUSD | 0.74 | ACTIF | → neutral | +1.1% | ACTIF · 0.68 | |
| SOLUSDT | 0.68 | ACTIF | ↓ breakdown+retest | -2.3% | NORMAL · 0.55 | |
| BTCUSD | 0.12 | MORT | ↓ below EMA | -0.1% | MORT · 0.14 | ⛔ |

> **7 colonnes max.** `VI Score` et `TF+1` affichés en `0.xx` (échelle native 0–1, pas en %) — cohérent avec les seuils de régime, sans confusion avec la colonne `24h %`.
> `TF+1` = régime + VI score du TF directement supérieur (depuis `volatility_snapshots`, pas de calcul live) : 15m→1h / 1h→4h / 4h→1d / 1d→masqué.
> Colonne `⚠️` : `⚠️` si EXTRÊME, `⛔` si MORT, vide sinon.
> **Écarté volontairement** : Funding Rate, OI/Volume, MDI, VI_ratio, EMA_1w, stop_distance — Phase 3+.
> Le signal EMA bidirectionnel (↑ long / ↓ short) identifie le biais sans imposer de direction.

---

## 📌 Non-goals Phase 2 (déféré Phase 3+)

- Auto-trading Kraken (Phase 4)
- ML/prediction sur le VI score (hors scope)
- Monitoring 317 pairs en continu (watchlist exhaustive) → Phase 3
- Paramétrage fin des périodes d'indicateurs (multi-EMA par TF) → Phase 3 ou preset avancé
- OI/Volume, Funding Rate dans les watchlists → Phase 3 (nécessite Kraken Futures API)
