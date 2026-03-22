# Phase 4C — Notification Overhaul

**Status:** In progress  
**Scope:** VI level/range alerts · per-bot test · day_type filter · multi-profile support  
**Commit baseline:** `63b9b09` (day_type), `21b3ff4` (multi-profile + root cause fix)

---

## 1. Architecture Overview

Telegram alerts are **co-located inside `compute_market_vi`** (Celery beat task).  
There is no separate notification task — alerts are evaluated as a tail step of every VI computation.

```
Celery Beat
  │
  ├─ compute_market_vi("15m")   every 15 min
  │    └─ section 10: iterate all profiles → check VI levels → Telegram
  │
  ├─ compute_market_vi("1h")    every 1h  (minute=0)
  │    └─ section 10: same
  │
  ├─ compute_market_vi("4h")    every 4h
  │    └─ section 10: same
  │
  ├─ compute_market_vi("1d")    daily at 00:00 UTC
  │    └─ section 10: same
  │
  └─ compute_market_vi("1w")    weekly Monday 01:00 UTC
       └─ section 10: same
```

### Alert frequency / latency by timeframe

| Alert TF filter | Evaluated by | Max latency |
|-----------------|-------------|------------|
| `15m`           | 15m job     | 15 min     |
| `1h`            | 1h job      | 60 min     |
| `4h`            | 4h job      | 4 h        |
| `1d`            | 1d job      | 24 h       |
| *(All TFs — no filter)* | **every** job | **15 min** |

> **Key insight:** The `1h` VI score is computed from 1h candle data that can only change every hour.  
> Checking more frequently would just read stale data — the data freshness ceiling IS the job interval.
>
> **Tip:** For maximum reactivity on a given level, leave the TF filter to "All TFs" (empty).  
> The alert will then be evaluated every 15 min against the cached 15m VI.  
> If you specifically need a 1h-data alert, the 60-min latency is architecturally correct.

---

## 2. notification_settings — DB Schema

Single table, Config Table Pattern (JSONB per-profile), Phase 2 addition.

```sql
CREATE TABLE notification_settings (
    profile_id  BIGINT  PRIMARY KEY REFERENCES profiles(id) ON DELETE CASCADE,
    config      JSONB   NOT NULL DEFAULT '{}',
    updated_at  TIMESTAMP NOT NULL DEFAULT NOW()
);
```

The `config` JSONB currently holds one top-level key: `market_vi_alerts`.

### `market_vi_alerts` structure

```json
{
  "enabled": true,
  "bot_name": "my-bot",
  "vi_levels": [ ...VILevel... ],
  "regime_alerts": { ... }
}
```

---

## 3. VILevel Schema

Each item in `vi_levels` array:

| Field | Type | Description |
|-------|------|-------------|
| `id` | string | Unique ID (UUID or timestamp-based) |
| `label` | string? | Display name in Telegram message |
| `type` | `crossing` \| `range` | Alert type |
| `value` | number | Crossing: threshold (0–100) |
| `direction` | `up` \| `down` \| `both` | Crossing direction |
| `tolerance` | number | ±tolerance around value (e.g. 3 → fires at [45, 51] for 48) |
| `min` | number | Range: lower bound |
| `max` | number | Range: upper bound |
| `enabled` | boolean | Enable/disable this level |
| `cooldown_min` | number | Minutes between repeated alerts (min 1) |
| `timeframe` | string? | TF filter (`15m`, `1h`, `4h`, `1d`, `1w`) — undefined = All TFs |
| `day_type` | `any` \| `workday` \| `weekend`? | Day filter — undefined or `any` = no filter |

---

## 4. Alert Evaluation Logic (`telegram.py`)

### Crossing alert

```
in_zone = abs(curr - value) <= tolerance

if prev_score is None:           # first cycle after restart / no history
    triggered = in_zone          # fire immediately if already inside zone

else:
    up   = prev was below zone AND curr entered zone from below
    down = prev was above zone AND curr entered zone from above
    triggered = (direction matches)
```

### Range alert

```
triggered = min <= curr <= max
```

### Filters (evaluated before trigger check)

1. **TF filter** — if `lv.timeframe` is set and != current job timeframe → skip
2. **Day type filter** — if `workday` and today is Sat/Sun → skip; if `weekend` and today is Mon–Fri → skip
3. **Cooldown** — Redis key `atd:alert_sent:vi_level:{profile_id}:{timeframe}:{level_id}` with `SETEX cooldown_min*60`; if key exists → skip

---

## 5. Redis Keys

| Key | TTL | Purpose |
|-----|-----|---------|
| `atd:market_vi:{tf}` | computed TTL | Cached VI score (all TFs) |
| `atd:vi_prev_score:{profile_id}:{tf}` | no TTL | Previous VI score for crossing detection |
| `atd:alert_sent:vi_level:{profile_id}:{tf}:{level_id}` | `cooldown_min * 60s` | Cooldown lock per alert |

> Keys are scoped by `profile_id` to avoid cross-profile interference.

---

## 6. Multi-Profile Support

`tasks.py` section 10 iterates **all rows** in `notification_settings`:

```python
all_notifs = db.query(NotificationSettings).all()
for notif in all_notifs:
    if not notif.market_vi_alerts.get("enabled", False):
        continue
    if not bot_token or not chat_id:
        continue
    # evaluate vi_levels for this profile independently
```

Previously: `.first()` was used → only `profile_id=1` (empty row) was evaluated → **no alerts ever fired**.  
Fixed in commit `21b3ff4`.

---

## 7. Aggregated TF Alerts (section 10c)

After per-timeframe checks, the task also checks levels whose `timeframe == "aggregated"`:

- Reads `get_cached_market_vi("aggregated")` from Redis  
- Uses its own `prev_score` key: `atd:vi_prev_score:{profile_id}:aggregated`  
- Fires independently from the main TF check

---

## 8. Frontend — NotificationsSettingsPage

Key state:

| State | Type | Default | Notes |
|-------|------|---------|-------|
| `vlTf` | string | `''` | `''` = All TFs. Was `'aggregated'` (bug — blocked 15m alerts) |
| `vlDayType` | `any\|workday\|weekend` | `'any'` | Day filter for new level |
| `editDraft.tfStr` | string | `lv.timeframe ?? ''` | Was `?? 'aggregated'` (same bug) |

Level badges:
- Amber chip: TF label (if set)
- Violet chip: `WD` (workday) or `WKD` (weekend) if day_type set

---

## 9. Bug History

| Bug | Root Cause | Fix |
|-----|-----------|-----|
| Alerts never fired | `tasks.py` used `.first()` → returned empty profile row | Iterate `.all()`, skip if not enabled |
| All new levels got `timeframe: 'aggregated'` | `vlTf` state defaulted to `'aggregated'` | Default changed to `''` |
| First cycle after restart never fired if VI already in zone | `prev_score_100 is None` had no trigger logic | Added `triggered = in_zone` for first cycle |
| AGG alerts ignored `enabled` flag | Missing guard in section 10c | Added `if agg_levels:` (already inside `enabled` loop) |
| VI 26 appeared as both support and resistance | `visitTol != clusterTol` → same zone matched both directions | Set `visitTol = clusterTol` + post-dedup pass |
