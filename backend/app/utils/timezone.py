from __future__ import annotations

from datetime import datetime
from zoneinfo import ZoneInfo

DB_TIMEZONE = "America/Sao_Paulo"
BRASILIA_TZ = ZoneInfo(DB_TIMEZONE)


def now_brasilia() -> datetime:
    return datetime.now(BRASILIA_TZ)

