from __future__ import annotations

import sys
from pathlib import Path

from loguru import logger


def configure_logging(level: str = "INFO", logs_dir: Path | None = None) -> None:
    destination = logs_dir or Path("logs")
    destination.mkdir(parents=True, exist_ok=True)
    normalized_level = str(level or "INFO").upper()

    logger.remove()
    console_stream = sys.stdout or sys.stderr or sys.__stdout__ or sys.__stderr__
    if console_stream is not None and hasattr(console_stream, "write"):
        logger.add(console_stream, level=normalized_level, enqueue=True)
    logger.add(
        destination / "app.log",
        level=normalized_level,
        enqueue=True,
        rotation="20 MB",
        retention="30 days",
        encoding="utf-8",
    )


def get_logger():
    return logger
