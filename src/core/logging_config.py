"""
Logging configuration — AlphaTradingDesk backend.

Call setup_logging() once at application startup (src/main.py).

Behaviour by environment:
  dev  → stdout, colorized console (structlog ConsoleRenderer)
  prod → stdout JSON (structlog JSONRenderer) — parsed by Promtail/Loki
  test → stdout plain text (minimal noise in CI)

JSON output fields (prod):
  {"timestamp": "...", "level": "info", "logger": "src.goals.router",
   "message": "POST /goals — goal 8 created", "request_id": "..."}

Promtail pipeline labels: level, logger — defined in config/promtail/promtail.yml

LOG_LEVEL env var overrides the default (INFO).
LOG_DIR   env var sets the log directory (prod only — ignored in dev/test).
"""

from __future__ import annotations

import logging
import logging.handlers
import os
import sys

import structlog


def setup_logging(
    level: str = "INFO",
    log_dir: str | None = None,
    environment: str = "dev",
) -> None:
    """
    Configure structlog + stdlib root logger.

    Args:
        level:       Log level string — DEBUG | INFO | WARNING | ERROR | CRITICAL
        log_dir:     Directory for log files (prod only). None = stdout only.
        environment: "dev" | "test" | "prod"
    """
    numeric_level = getattr(logging, level.upper(), logging.INFO)

    # ── Shared pre-chain processors ────────────────────────────────────────────
    # Applied to every log record before the final renderer
    pre_chain: list = [
        structlog.contextvars.merge_contextvars,
        structlog.stdlib.add_log_level,
        structlog.stdlib.add_logger_name,
        structlog.stdlib.PositionalArgumentsFormatter(),
        structlog.processors.StackInfoRenderer(),
        structlog.processors.TimeStamper(fmt="iso", utc=True),
    ]

    # ── Final renderer — JSON in prod, console in dev ──────────────────────────
    if environment == "dev":
        renderer = structlog.dev.ConsoleRenderer()
    else:
        # Rename "event" → "message" so Promtail's pipeline finds the key
        def _rename_event(logger: object, method: str, event_dict: dict) -> dict:  # noqa: ANN001
            event_dict["message"] = event_dict.pop("event", "")
            return event_dict

        renderer = structlog.processors.JSONRenderer()  # type: ignore[assignment]
        pre_chain = pre_chain + [_rename_event]

    # ── Configure structlog ────────────────────────────────────────────────────
    structlog.configure(
        processors=pre_chain + [renderer],
        wrapper_class=structlog.stdlib.BoundLogger,
        context_class=dict,
        logger_factory=structlog.stdlib.LoggerFactory(),
        cache_logger_on_first_use=True,
    )

    # ── Stdlib bridge — intercepts all logging.getLogger() calls ──────────────
    formatter = structlog.stdlib.ProcessorFormatter(
        foreign_pre_chain=pre_chain,
        processors=[
            structlog.stdlib.ProcessorFormatter.remove_processors_meta,
            renderer,
        ],
    )

    handlers: list[logging.Handler] = []

    stdout_handler = logging.StreamHandler(sys.stdout)
    stdout_handler.setFormatter(formatter)
    stdout_handler.setLevel(numeric_level)
    handlers.append(stdout_handler)

    # ── File handler (prod only) ───────────────────────────────────────────────
    if log_dir and environment == "prod":
        try:
            os.makedirs(log_dir, exist_ok=True)
            log_file = os.path.join(log_dir, "backend.log")
            file_handler = logging.handlers.RotatingFileHandler(
                filename=log_file,
                maxBytes=10 * 1024 * 1024,
                backupCount=5,
                encoding="utf-8",
            )
            file_handler.setFormatter(formatter)
            file_handler.setLevel(numeric_level)
            handlers.append(file_handler)
        except OSError:
            pass  # read-only fs (CI) — stdout only

    # ── Root logger ────────────────────────────────────────────────────────────
    root = logging.getLogger()
    root.handlers.clear()
    root.setLevel(numeric_level)
    for h in handlers:
        root.addHandler(h)

    # ── Third-party noise reduction ────────────────────────────────────────────
    logging.getLogger("uvicorn").setLevel(logging.INFO)
    logging.getLogger("uvicorn.access").setLevel(logging.INFO)
    logging.getLogger("uvicorn.error").setLevel(logging.INFO)
    if numeric_level > logging.DEBUG:
        logging.getLogger("sqlalchemy.engine").setLevel(logging.WARNING)
        logging.getLogger("sqlalchemy.pool").setLevel(logging.WARNING)
    logging.getLogger("alembic").setLevel(logging.INFO)

    logging.getLogger(__name__).info(
        "Logging configured — level=%s env=%s renderer=%s",
        level.upper(),
        environment,
        "json" if environment != "dev" else "console",
    )

