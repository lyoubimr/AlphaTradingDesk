"""p8005 — Fix ema_bonus_threshold in ritual_settings JSONB (70 → 0.70)

The DEFAULT_RITUAL_CONFIG had "ema_bonus_threshold": 70 instead of 0.70.
EMA scores are stored as floats in the range 0.0–1.0 (compute_ema_score returns 0.0–1.0),
so the threshold of 70 was unreachable — the EMA quality bonus (+10%) never fired.

This migration corrects all existing ritual_settings rows that still carry the
buggy value (70), replacing it with the correct float 0.70.
A row is only updated if:
  - config->'smart_filter' exists
  - AND config->'smart_filter'->>'ema_bonus_threshold' = '70'  (integer 70, not 0.70)

Profiles that already customised the value (e.g. set 0.80 manually) are untouched.
New profiles seeded after this migration receive 0.70 from DEFAULT_RITUAL_CONFIG.

Revision ID: p8005_fix_ema_bonus_threshold
Revises:     p8004_fix_ritual_session_type_constraint
Create Date: 2026-05-14
"""

from alembic import op

revision = "p8005_fix_ema_bonus_threshold"
down_revision = "p8004_fix_ritual_session_type_constraint"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Patch only rows where smart_filter.ema_bonus_threshold is still the buggy integer 70.
    # jsonb_set replaces the key in-place; the rest of the config is untouched.
    # CAST('70' AS text) matches the stored JSON representation of the integer 70.
    # Guard against fresh test DBs where ritual_settings may not exist yet.
    op.execute(
        """
        DO $$
        BEGIN
            IF EXISTS (
                SELECT 1 FROM information_schema.tables
                WHERE table_name = 'ritual_settings'
            ) THEN
                UPDATE ritual_settings
                SET config = jsonb_set(
                    config,
                    '{smart_filter,ema_bonus_threshold}',
                    '0.7'::jsonb,
                    false
                )
                WHERE
                    config ? 'smart_filter'
                    AND (config -> 'smart_filter' ->> 'ema_bonus_threshold') = '70';
            END IF;
        END
        $$;
        """
    )


def downgrade() -> None:
    # Restore the buggy value for rollback (matches the old DEFAULT).
    op.execute(
        """
        DO $$
        BEGIN
            IF EXISTS (
                SELECT 1 FROM information_schema.tables
                WHERE table_name = 'ritual_settings'
            ) THEN
                UPDATE ritual_settings
                SET config = jsonb_set(
                    config,
                    '{smart_filter,ema_bonus_threshold}',
                    '70'::jsonb,
                    false
                )
                WHERE
                    config ? 'smart_filter'
                    AND (config -> 'smart_filter' ->> 'ema_bonus_threshold') = '0.7';
            END IF;
        END
        $$;
        """
    )
