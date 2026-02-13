from __future__ import annotations

from dataclasses import dataclass
from typing import Literal

RunStatus = Literal["running", "success", "failed", "partial"]
StepName = Literal["refresh", "load_staging", "validate", "promote", "cleanup"]


@dataclass
class StepCounters:
    rows_in: int | None = None
    rows_out: int | None = None
    rows_rejected: int | None = None
    details: dict | None = None