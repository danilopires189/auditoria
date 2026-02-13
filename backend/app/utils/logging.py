from __future__ import annotations

import sys
from pathlib import Path

from loguru import logger


def configure_logging(level: str = "INFO", logs_dir: Path | None = None) -> None:
    destination = logs_dir or Path("logs")
    destination.mkdir(parents=True, exist_ok=True)

    logger.remove()
    logger.add(sys.stdout, level=level.upper(), enqueue=True)
    logger.add(
        destination / "app.log",
        level=level.upper(),
        enqueue=True,
        rotation="20 MB",
        retention="30 days",
        encoding="utf-8",
    )


def get_logger():
    return logger