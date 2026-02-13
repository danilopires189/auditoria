from __future__ import annotations

from datetime import date, datetime
from decimal import Decimal
from typing import Any

import pandas as pd

try:
    import numpy as np
except Exception:  # pragma: no cover
    np = None


def to_json_safe(value: Any) -> Any:
    if value is None:
        return None

    if isinstance(value, dict):
        return {str(k): to_json_safe(v) for k, v in value.items()}

    if isinstance(value, (list, tuple, set)):
        return [to_json_safe(v) for v in value]

    if isinstance(value, (datetime, date)):
        return value.isoformat()

    if isinstance(value, Decimal):
        return str(value)

    if np is not None and isinstance(value, np.generic):
        return value.item()

    if isinstance(value, pd.Timestamp):
        return value.isoformat()

    if isinstance(value, pd.Timedelta):
        return str(value)

    try:
        if pd.isna(value):
            return None
    except Exception:
        pass

    return value
