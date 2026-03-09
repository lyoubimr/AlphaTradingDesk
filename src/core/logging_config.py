"""
Logging configuration — AlphaTradingDesk backend.

Call setup_logging() once at application startup (src/main.py).

Behaviour by environment:
  dev  → stdout, colorized, DEBUG level by default
  prod → stdout + rotating file (/srv/atd/logs/app/backend.log by default)
         logrotate on the Dell handles the final rotation (external)
         RotatingFileHandler is a safety net inside the process

Log format:
  2026-03-09 14:32:01 | INFO     | src.goals.router       | POST /goals — goal 8 created
  ^timestamp           ^level    ^logger name (module)     ^message

LOG_LEVEL env var overrides the default (DEBUG in dev, INFO in prod).
LOG_DIR   env var sets the log directory (prod only — ignored in dev).
"""

from __future__ import annotations

import logging
import logging.handlers
import os
import sys


def setup_logging(
    level: str = "INFO",
    log_dir: str | None = None,
    environment: str = "dev",
) -> None:
    """
    Configure the root logger and all relevant loggers.

    Args:
        level:       Log level string — DEBUG | INFO | WARNING | ERROR | CRITICAL
        log_dir:     Directory for log files (prod only). None = stdout only.
        environment: "dev" | "test" | "prod"
    """
    numeric_level = getattr(logging, level.upper(), logging.INFO)

    # ── Formatters ────────────────────────────────────────────────────────────
    # Prod / file: plain text, full timestamp
    plain_fmt = logging.Formatter(
        fmt="%(asctime)s | %(levelname)-8s | %(name)-40s | %(message)s",
        datefmt="%Y-%m-%d %H:%M:%S",
    )
    # Dev / stdout: shorter, easier to read in terminal
    dev_fmt = logging.Formatter(
        fmt="%(asctime)s | %(levelname)-8s | %(name)s — %(message)s",
        datefmt="%H:%M:%S",
    )

    handlers: list[logging.Handler] = []

    # ── stdout handler ────────────────────────────────────────────────────────
    stdout_handler = logging.StreamHandler(sys.stdout)
    stdout_handler.setFormatter(dev_fmt if environment == "dev" else plain_fmt)
    stdout_handler.setLevel(numeric_level)
    handlers.append(stdout_handler)

    # ── File handler (prod only) ──────────────────────────────────────────────
    if log_dir and environment != "dev":
        try:
            os.makedirs(log_dir, exist_ok=True)
        except OSError:
            # Log dir not accessible (CI, read-only fs) — fall back to stdout only
            log_dir = None
    if log_dir and environment != "dev":
        log_file = os.path.join(log_dir, "backend.log")
        # RotatingFileHandler: safety net inside the process
        # 10 MB max per file, keep 5 backups → max 50 MB
        # External logrotate on the Dell takes over for long-term archiving
        file_handler = logging.handlers.RotatingFileHandler(
            filename=log_file,
            maxBytes=10 * 1024 * 1024,  # 10 MB
            backupCount=5,
            encoding="utf-8",
        )
        file_handler.setFormatter(plain_fmt)
        file_handler.setLevel(numeric_level)
        handlers.append(file_handler)

    # ── Root logger ───────────────────────────────────────────────────────────
    root = logging.getLogger()
    root.setLevel(numeric_level)
    # Remove any existing handlers (avoid duplicate logs on hot-reload)
    root.handlers.clear()
    for h in handlers:
        root.addHandler(h)

    # ── Third-party noise reduction ───────────────────────────────────────────
    # uvicorn already has its own access log — keep it but reduce sqlalchemy noise
    logging.getLogger("uvicorn").setLevel(logging.INFO)
    logging.getLogger("uvicorn.access").setLevel(logging.INFO)
    logging.getLogger("uvicorn.error").setLevel(logging.INFO)
    # SQLAlchemy engine logs every SQL statement at DEBUG — too noisy by default
    # Set to WARNING unless LOG_LEVEL=DEBUG is explicitly requested
    if numeric_level > logging.DEBUG:
        logging.getLogger("sqlalchemy.engine").setLevel(logging.WARNING)
        logging.getLogger("sqlalchemy.pool").setLevel(logging.WARNING)
    # Alembic migration logs → INFO always (useful to track migrations in prod)
    logging.getLogger("alembic").setLevel(logging.INFO)

    logging.getLogger(__name__).info(
        "Logging configured — level=%s  env=%s  file=%s",
        level.upper(),
        environment,
        os.path.join(log_dir, "backend.log") if log_dir and environment != "dev" else "stdout only",
    )
