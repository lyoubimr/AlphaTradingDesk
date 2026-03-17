# 📐 Phase 3 — Pre-Implementation Scope

**Date:** 17 mars 2026
**Version:** 1.0
**Status:** 📝 Draft — en attente de validation

> Ce document synthétise toutes les décisions de design de Phase 3.
> Voir `implement-phase3.md` pour le plan d'implémentation step-by-step.

---

## 🎯 Scope Phase 3 — Dynamic Risk Management

Phase 3 enrichit le module Risk Management existant avec une logique **contextuelle et adaptive** :
le risque par trade n'est plus un % fixe — il est **ajusté dynamiquement** en fonction de
l'état du marché, du pair, de la stratégie et de la confiance du trader, de façon
**transparente et configurable**.

```
Phase 3 scope :
  1. Dynamic Risk Multiplier        ← moteur de calcul multi-critères (engine)
  2. Live Pair VI (trade form)      ← fetch Kraken en temps réel à la saisie
  3. Risk Guard (blocage)           ← bloquer si plus de budget risk concurrent
  4. Dashboard Global Alert         ← warning si risk saturé + LIMITs en cours
  5. Risk Settings (per profile)    ← activer/désactiver critères + weights
  6. Risk Advisor UI (trade form)   ← breakdown transparent + override manuel
```

---

## 🧮 Dynamic Risk Multiplier — Algorithme

### Principe

```
adjusted_risk_pct = base_risk_pct × multiplier

où :
  base_risk_pct = profile.risk_percentage_default  (ex : 2%)
  multiplier    = moyenne pondérée des facteurs activés
```

Le `multiplier` peut dépasser 1.0 si les conditions sont favorables → le risque agrandi.
Il est plafonné par `config.global_multiplier_max` (défaut : 2.0, configurable).

### Les 5 critères

| Critère | Source | Description |
|---------|--------|-------------|
| **Market VI** | Redis cache (`atd:market_vi:<tf>`) | Regime actuel du marché |
| **Pair VI** | Fetch Kraken live au moment du trade | Volatilité spécifique au pair |
| **MA Direction** | Session market analysis courante du profil | Direction analysée vs direction du trade |
| **Strategy Win Rate** | `strategies.win_count / trades_count` | WR, ignoré si insuffisamment de trades |
| **Confidence Score** | `trades.confidence_score` (0-100) | Score de confiance saisi par le trader |

### Calcul détaillé

Chaque critère activé produit un **facteur** (float ≥ 0) — 1.0 = neutre, > 1.0 = boost, < 1.0 = réduction.

```python
# Pseudo-code moteur
enabled = [c for c in criteria if c.enabled]
total_weight = sum(c.weight for c in enabled)

multiplier = sum(
    (c.factor / total_weight) * c.weight
    for c in enabled
)
multiplier = min(multiplier, config.global_multiplier_max)
adjusted_risk_pct = base_risk_pct * multiplier
```

#### Facteurs par critère

**Market VI & Pair VI** — mapping regime → facteur :
```json
{
  "DEAD":     0.30,
  "CALM":     0.60,
  "NORMAL":   0.85,
  "TRENDING": 1.30,
  "ACTIVE":   1.00,
  "EXTREME":  0.50
}
```
> TRENDING = sweet spot → boost. EXTREME = danger → réduction. DEAD = marché mort → quasi-blocage.

**MA Direction** — comparaison direction trade vs opinion analysée :
```
trade direction == MA direction analysée → facteur 1.30 (aligné)
pas d'analyse disponible / module non utilisé → facteur 1.00 (neutre)
trade direction ≠  MA direction analysée → facteur 0.60 (à contre-courant)
```

**Strategy Win Rate** — linéaire entre borne basse et haute (configurable) :
```python
if strategy.trades_count < strategy.min_trades_for_stats:
    factor = 1.0  # neutre — pas assez de données
else:
    wr = strategy.win_count / strategy.trades_count  # 0.0–1.0
    # Interpolation linéaire entre wr_min_factor et wr_max_factor
    # Défaut : wr=0.0 → 0.5 / wr=0.5 → 1.0 / wr=1.0 → 1.5
    factor = wr_min_factor + wr * (wr_max_factor - wr_min_factor)
    factor = clamp(factor, wr_min_factor, wr_max_factor)
```

**Confidence Score** — linéaire 0-100 :
```python
# confidence=0 → 0.5 / confidence=50 → 1.0 / confidence=100 → 1.5
factor = confidence_min_factor + (score / 100) * (confidence_max_factor - confidence_min_factor)
```

### Exemple concret

```
Profile: risk_default = 2%, capital = 10 000€

Critères activés (weights normalisés si nécessaire) :
  Market VI   : TRENDING → 1.30  (weight 0.20)
  Pair VI     : ACTIVE   → 1.00  (weight 0.25)
  MA Direction: aligné   → 1.30  (weight 0.20)
  Strategy WR : 65%      → 1.15  (weight 0.20)
  Confidence  : 80/100   → 1.30  (weight 0.15)

multiplier = 1.30×0.20 + 1.00×0.25 + 1.30×0.20 + 1.15×0.20 + 1.30×0.15
           = 0.26 + 0.25 + 0.26 + 0.23 + 0.195
           = 1.195

adjusted_risk_pct = 2% × 1.195 = 2.39%
risk_amount       = 10 000 × 2.39% = 239€  (base : 200€)

Breakdown affiché :
  Base risk  : 200€ (2.00%)
  Multiplier : ×1.20
  Adjusted   : 239€ (2.39%)  ← trader peut accepter ou overrider
```

---

## 🛡️ Risk Guard — Blocage concurrent

### Budget de risque concurrent

```
concurrent_risk_used = Σ(risk_amount des trades open + pending) / capital_current × 100
budget_remaining     = max_concurrent_risk_pct - concurrent_risk_used
```

**Règle :** si `adjusted_risk_amount > budget_remaining × capital_current`, le trade est **bloqué**.

L'utilisateur peut **forcer** l'ouverture avec un paramètre `force: bool` explicite (avec confirmation UI).

### Prise en compte du budget restant

Le moteur communique aussi le budget restant. Si `adjusted_risk_pct > budget_remaining`, le système propose **automatiquement** de ramener le risque au budget disponible :

```
budget_remaining_pct = max_concurrent_risk_pct - concurrent_risk_used = 0.8%
adjusted_risk_pct    = 2.39%   ← dépasse le budget

→ proposition : réduire à 0.8% (budget restant)
→ ou forcer avec confirmation (dépasse max_concurrent)
```

---

## ⚠️ Dashboard Global Alert

Condition de déclenchement :
```
concurrent_risk_used ≥ max_concurrent_risk_pct
ET count(trades WHERE status = 'pending') > 0
```

Affichage : une bande d'alerte globale en haut du dashboard (et dans la sidebar) :
> ⚠️ **Risque concurrent saturé** · X limite(s) en attente — pensez à fermer vos ordres LIMIT
> avant d'ouvrir de nouvelles positions.

---

## ⚙️ Risk Settings (per profile)

Un nouvel écran Settings → Risk Management → Risk Advisor per profile.

Structure JSONB `risk_settings.config` :

```json
{
  "criteria": {
    "market_vi": {
      "enabled": true,
      "weight": 0.20,
      "factors": {"DEAD": 0.30, "CALM": 0.60, "NORMAL": 0.85, "TRENDING": 1.30, "ACTIVE": 1.00, "EXTREME": 0.50}
    },
    "pair_vi": {
      "enabled": true,
      "weight": 0.25,
      "factors": {"DEAD": 0.30, "CALM": 0.60, "NORMAL": 0.85, "TRENDING": 1.30, "ACTIVE": 1.00, "EXTREME": 0.50}
    },
    "ma_direction": {
      "enabled": true,
      "weight": 0.20,
      "factors": {"aligned": 1.30, "neutral": 1.00, "opposed": 0.60}
    },
    "strategy_wr": {
      "enabled": true,
      "weight": 0.20,
      "min_factor": 0.50,
      "max_factor": 1.50
    },
    "confidence": {
      "enabled": true,
      "weight": 0.15,
      "min_factor": 0.50,
      "max_factor": 1.50
    }
  },
  "global_multiplier_max": 2.0
}
```

**Règles de validation côté backend :**
- La somme des `weight` des critères activés doit être normalisée au runtime (pas validée strictement à la saisie — on normalise à la volée)
- `global_multiplier_max` ∈ [1.0, 3.0]
- Chaque `factor` ∈ [0.1, 3.0]

---

## 🖥️ Risk Advisor UI (formulaire nouveau trade)

Panneau inline dans le formulaire "New Trade" (après saisie du pair, TF, direction) :

```
┌─ Risk Advisor ────────────────────────────────────────────────────┐
│  Base risk : 2.00% = 200€                                         │
│                                                                    │
│  ✅ Market VI       TRENDING    ×1.30  (weight 20%) → +0.26       │
│  ✅ Pair VI         ACTIVE      ×1.00  (weight 25%) → +0.25       │
│  ✅ MA Direction    Aligned ↑   ×1.30  (weight 20%) → +0.26       │
│  ✅ Strategy WR     65%         ×1.15  (weight 20%) → +0.23       │
│  ✅ Confidence      80/100      ×1.30  (weight 15%) → +0.195      │
│  ─────────────────────────────────────────────────────────────    │
│  Multiplier : ×1.195                                               │
│  Adjusted risk : 2.39%  =  239€                                   │
│                                                                    │
│  [✅ Accepter 239€]  [✏️ Override manuel]  [🔒 Forcer base 200€]  │
└────────────────────────────────────────────────────────────────────┘
```

- Chaque ligne montre : état critère · valeur détectée · facteur · poids · contribution
- Mise à jour en temps réel quand le trader change le pair/TF/direction/confidence
- Pair VI = fetch live au changement de pair (spinner pendant la requête)
- Override manuel : input numérique libre pour le risk %
- La valeur acceptée est envoyée dans `risk_pct_override` au backend

---

## 🗄️ DB Schema — Nouvelle table

```sql
CREATE TABLE risk_settings (
    id          BIGSERIAL PRIMARY KEY,
    profile_id  BIGINT NOT NULL UNIQUE REFERENCES profiles(id) ON DELETE CASCADE,
    config      JSONB NOT NULL DEFAULT '{}',
    updated_at  TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_risk_settings_profile ON risk_settings(profile_id);
```

**Pas de migration destructive.** Table créée avec `IF NOT EXISTS`.
Valeurs par défaut injectées automatiquement si aucune ligne n'existe pour un profile.

---

## 🔗 Intégrations existantes à enrichir

| Fichier / Endpoint | Changement |
|--------------------|-----------|
| `POST /api/trades` | Vérifier budget concurrent avant open · accepter `dynamic_risk_snapshot` JSONB |
| `trades` table | Ajouter colonne `dynamic_risk_snapshot JSONB` (détail du calcul au moment du trade) |
| `GET /api/risk/advisor?profile_id=&pair=&timeframe=&direction=&strategy_id=&confidence=` | NEW endpoint — retourne le breakdown complet |
| `GET /api/risk/settings/{profile_id}` | NEW — lire config |
| `PUT /api/risk/settings/{profile_id}` | NEW — mettre à jour config |
| `GET /api/risk/budget/{profile_id}` | NEW — budget concurrent restant |
| Dashboard | Récupérer alerte concurrent au load |

---

## 🚫 Hors scope Phase 3

| ❌ | Raison |
|----|--------|
| Automatisation des trades (exécution Kraken) | Phase 4 |
| Watchlist generation avancée | Phase 3-bis (watchlist) |
| Alerting Telegram pour risk events | Phase 4 |
| Support CFD dans le Risk Advisor | Phase 3 = Crypto (Kraken) only for live VI |

---

## ✅ Critères de validation Phase 3

- [ ] Engine retourne le bon multiplier pour chaque combinaison de critères
- [ ] WR strategy neutre quand `trades_count < min_trades_for_stats`
- [ ] Blocage concurrent fonctionne + force override OK
- [ ] Dashboard alerte n'apparaît que si conditions réunies
- [ ] Settings per-profile: GET/PUT cycle complet
- [ ] Risk Advisor UI se met à jour live quand pair change
- [ ] `dynamic_risk_snapshot` persisté dans le trade
- [ ] Tests unitaires engine (>= 5 cas couverts)
