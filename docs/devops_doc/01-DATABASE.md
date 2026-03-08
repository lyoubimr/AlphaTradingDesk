# AlphaTradingDesk — Database

**Stack:** PostgreSQL 16 · SQLAlchemy 2.0 · Alembic · psycopg (v3)

---

## Architecture DB

```
┌─────────────────────────────────────────────────────────────────────┐
│  src/core/                                                           │
│  ├── config.py       → Settings.database_url (depuis env)           │
│  └── database.py     → engine + SessionLocal + get_db()             │
│       ↑ _normalise_db_url: postgresql:// → postgresql+psycopg://    │
│                                                                      │
│  src/core/models/                                                    │
│  └── *.py            → classes SQLAlchemy (mapped_column, ForeignKey)│
│                                                                      │
│  database/migrations/                                                │
│  ├── env.py          → config Alembic (lit DATABASE_URL)            │
│  └── versions/       → fichiers horodatés (upgrade/downgrade)       │
│       └── seeds/     → données de référence (idempotentes)          │
└─────────────────────────────────────────────────────────────────────┘
```

---

## Schéma Phase 1 — Tables et Relations

```
┌──────────────┐     ┌────────────────┐     ┌──────────────────┐
│   profiles   │─────│    trades      │─────│    positions     │
│              │1   N│                │1   N│  (TP levels)     │
│ capital      │     │ entry_price    │     │ tp_price         │
│ broker_id    │     │ stop_loss      │     │ lot_pct          │
│ market_type  │     │ status         │     │ closed_at        │
└──────┬───────┘     └────┬───────────┘     └──────────────────┘
       │                  │
       │             ┌────┴──────────┐     ┌──────────────────┐
       │             │ trade_tags    │─────│      tags        │
       │             │ trade_strat.  │─────│   strategies     │
       │             │ perf_snapsh.  │     │  (global/profil) │
       │             └───────────────┘     └──────────────────┘
       │
       ├── profile_goals ───── goal_progress_log
       ├── user_preferences
       └── market_analysis_sessions ─── market_analysis_answers

Référentiels (seeded, rarement modifiés) :
  brokers · instruments · trading_styles · sessions
  note_templates · weekly_events
  market_analysis_modules · market_analysis_indicators
  market_analysis_configs · profile_indicator_config
  news_provider_config
```

### Tables principales

| Table | Rôle |
|-------|------|
| `profiles` | Compte de trading (capital courant, broker, market_type) |
| `trades` | Journal des trades — status: `open` / `partial` / `closed` |
| `positions` | TP levels d'un trade (1 trade → N positions avec tp_price + lot_pct) |
| `strategies` | Stratégies de trading — `profile_id=NULL` = globale |
| `trade_strategies` | Junction trades ↔ strategies (many-to-many) |
| `tags` / `trade_tags` | Tags libres sur les trades |
| `performance_snapshots` | Screenshots liés à un trade |
| `brokers` | Référentiel courtiers |
| `instruments` | Paires/actifs par broker (BTC/USD, XAU/USD, etc.) |
| `trading_styles` | scalping / day / swing / position |
| `profile_goals` | Objectifs par profil + style + période |
| `goal_progress_log` | Snapshots historiques de performance |
| `note_templates` | Templates de notes pour les trades |
| `sessions` | Sessions de marché (Asian / London / New York) |
| `market_analysis_*` | Modules, indicateurs, configs, sessions, réponses |
| `user_preferences` | Préférences UI par profil |
| `weekly_events` | Agenda macro |

---

## Connexion à la DB

### Dev local (dans le container)
```bash
# Shell psql interactif
docker exec -it alphatradingdesk-db-1 psql -U atd -d atd_dev

# Commande directe
docker exec alphatradingdesk-db-1 psql -U atd -d atd_dev -c "SELECT version();"

# Adminer GUI
open http://localhost:8080
# Serveur: db | User: atd | MDP: dev_password | DB: atd_dev
```

### Mac → Postgres directement (port 5432 exposé en dev)
```bash
psql postgresql://atd:dev_password@localhost:5432/atd_dev
```

### Prod Dell
```bash
# Via docker exec (port 5432 non exposé en prod — sécurité)
ssh atd
docker compose -f ~/apps/docker-compose.prod.yml exec db \
  psql -U atd -d atd_prod
```

---

## Alembic — Workflow Complet

### Pourquoi Alembic ?
- Versioning du schéma DB exactement comme le code source
- `autogenerate` : compare les modèles Python avec le schéma DB → génère le SQL de migration
- Chaque migration = fichier horodaté avec `upgrade()` et `downgrade()`
- `alembic_version` table dans la DB : stocke la révision courante

### Workflow normal (modification de modèle)

```bash
# 1. Modifier le modèle dans src/core/models/
#    ex: ajouter un champ à Trade

# 2. Générer la migration
make db-revision msg="add notes_private to trades"
# → crée database/migrations/versions/XXXX_add_notes_private_to_trades.py

# 3. ⚠️ LIRE le fichier généré
#    Vérifier que upgrade() fait bien ce qu'on attend
#    Vérifier que downgrade() fait bien l'inverse
#    Alembic peut rater des renames ou des changements complexes

# 4. Appliquer
make db-upgrade

# 5. Vérifier
make db-current
```

### Commandes Alembic via Makefile

```bash
make db-upgrade          # applique toutes les migrations pendantes (head)
make db-downgrade        # rollback d'une migration (-1)
make db-current          # révision courante de la DB
make db-history          # liste toutes les migrations
make db-revision msg="..." # génère une migration depuis les modèles
make db-recover          # répare un stamp cassé (non-destructif)
make db-recover-full     # répare + reseed complet
```

### Commandes directes (sans Makefile)
```bash
APP_ENV=dev .venv/bin/alembic upgrade head
APP_ENV=dev .venv/bin/alembic downgrade -1
APP_ENV=dev .venv/bin/alembic current
APP_ENV=dev .venv/bin/alembic history --verbose
APP_ENV=dev .venv/bin/alembic revision --autogenerate -m "..."
```

### Cas particuliers — stamp cassé

```bash
# Symptôme : "relation X does not exist" alors que la table devrait exister
# Cause : DB wipée mais alembic_version a survécu (ou l'inverse)

# Cas 1 — tables présentes, stamp absent (restauration manuelle)
#   → alembic stamp head  (dit à Alembic "la DB est à jour" sans DDL)

# Cas 2 — stamp présent, tables absentes (volume wipé)
#   → DELETE FROM alembic_version + alembic upgrade head

# Fix automatique :
make db-recover
```

---

## Seeds — Données de Référence

### Hiérarchie

```
seed_all.py               → orchestrateur (appelé à chaque démarrage container)
  ├── seed_brokers.py          → Kraken, Vantage, Bybit, Interactive Brokers
  ├── seed_instruments.py      → BTC/USD, ETH/USD, XAU/USD, etc.
  ├── seed_trading_styles.py   → scalping, day, swing, position
  ├── seed_sessions.py         → Asian, London, New York
  ├── seed_note_templates.py   → templates de notes
  ├── seed_market_analysis.py  → modules Crypto + Gold, indicateurs HTF/MTF/LTF
  └── seed_global_strategies.py → stratégies globales (profile_id=NULL)

seed_test_data.py              → profils + trades réalistes (dev uniquement)
                                 appelé automatiquement en APP_ENV=dev si 0 profils
```

**Règle absolue :** tous les seeds utilisent `INSERT ... ON CONFLICT DO NOTHING`
→ idempotents, relançables sans risque, y compris sur une DB peuplée.

### Commandes

```bash
make db-seed              # seed de référence (safe, idempotent)
make db-seed-test         # profils + trades de test (dev seulement)
make db-seed-ma           # re-seed Market Analysis uniquement

# En prod, après une restauration :
docker compose -f ~/apps/docker-compose.prod.yml exec backend \
  python -m database.migrations.seeds.seed_all
```

---

## SQLAlchemy 2.0 — Patterns ATD

### Session et transactions

```python
# deps.py — dependency injection FastAPI
def get_db() -> Generator[Session, None, None]:
    db = SessionLocal()
    try:
        yield db
        db.commit()
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()

# Dans un router :
@router.post("/trades")
def create_trade(data: TradeCreate, db: Session = Depends(get_db)):
    return trades_service.create(db, data)
```

### Modèle typé (SQLAlchemy 2.0 style)

```python
class Trade(Base):
    __tablename__ = "trades"

    id: Mapped[int] = mapped_column(primary_key=True)
    profile_id: Mapped[int] = mapped_column(ForeignKey("profiles.id"))
    entry_price: Mapped[float]
    stop_loss: Mapped[float]
    status: Mapped[str] = mapped_column(default="open")
    created_at: Mapped[datetime] = mapped_column(default=func.now())

    profile: Mapped["Profile"] = relationship(back_populates="trades")
    positions: Mapped[list["Position"]] = relationship(back_populates="trade")
```

---

## Requêtes de Diagnostic

```sql
-- Révision Alembic courante
SELECT * FROM alembic_version;

-- Compter les lignes par table
SELECT relname AS table, n_live_tup AS rows
FROM pg_stat_user_tables
WHERE n_live_tup > 0
ORDER BY relname;

-- Lister les tables
\dt

-- Décrire une table
\d trades

-- Lister les FK d'une table
SELECT kcu.column_name, ccu.table_name AS foreign_table
FROM information_schema.table_constraints tc
JOIN information_schema.key_column_usage kcu
  ON tc.constraint_name = kcu.constraint_name
JOIN information_schema.referential_constraints rc
  ON tc.constraint_name = rc.constraint_name
JOIN information_schema.constraint_column_usage ccu
  ON rc.unique_constraint_name = ccu.constraint_name
WHERE tc.constraint_type = 'FOREIGN KEY'
  AND tc.table_name = 'trades';

-- Taille des tables
SELECT relname, pg_size_pretty(pg_total_relation_size(oid)) AS size
FROM pg_class WHERE relkind = 'r'
ORDER BY pg_total_relation_size(oid) DESC;
```

---

## Reset / Recovery

```bash
# Reset complet DEV (DESTRUCTIF — perd toutes les données)
make db-reset     # docker compose down + supprime le volume + docker compose up

# Reset + migrations + seed (tout reconstruire)
make db-refresh   # = db-reset + db-upgrade + db-seed + db-seed-test

# Réparer sans perdre de données
make db-recover       # détecte et corrige stamp cassé
make db-recover-full  # répare + reseed complet

# Vérifier l'état après recovery
make db-current
docker exec alphatradingdesk-db-1 psql -U atd -d atd_dev -c "\dt"
```

---

## Backup / Restore (prod)

```bash
# Backup manuel
ssh atd "~/apps/backup-db.sh rolling"

# Restore depuis le dernier backup
ssh atd
LATEST=$(ls -1t /srv/atd/backups/rolling/*.sql.gz | head -1)
zcat "$LATEST" | docker compose -f ~/apps/docker-compose.prod.yml exec -T db \
  psql -U atd atd_prod

# Vérifier l'intégrité après restore
docker compose -f ~/apps/docker-compose.prod.yml exec db \
  psql -U atd -d atd_prod -c "SELECT relname, n_live_tup FROM pg_stat_user_tables ORDER BY relname;"
```
