from __future__ import annotations

from dataclasses import dataclass
from decimal import Decimal
from typing import Any

import pandas as pd
from app.utils.json_safe import to_json_safe


def _safe_payload(row: pd.Series) -> dict[str, Any]:
    payload: dict[str, Any] = {}
    for key, value in row.items():
        if pd.isna(value):
            payload[key] = None
        else:
            payload[key] = to_json_safe(value)
    return payload


def _parse_numeric_scalar(value: Any) -> float | None:
    if value is None or pd.isna(value):
        return None
    if isinstance(value, (int, float, Decimal)):
        return float(value)

    text = str(value).strip()
    if text == "":
        return None

    if "," in text:
        text = text.replace(".", "").replace(",", ".")

    parsed = pd.to_numeric(pd.Series([text]), errors="coerce").iloc[0]
    if pd.isna(parsed):
        return None
    return float(parsed)


def _cast_numeric(series: pd.Series) -> pd.Series:
    return series.map(_parse_numeric_scalar).astype("Float64")


def _cast_integer(series: pd.Series) -> pd.Series:
    numeric = _cast_numeric(series)
    invalid_fraction = numeric.dropna().map(lambda x: abs(x - int(x)) > 0)
    if invalid_fraction.any():
        invalid_index = invalid_fraction[invalid_fraction].index
        numeric.loc[invalid_index] = pd.NA
    return numeric.round().astype("Int64")


def _cast_date(series: pd.Series) -> pd.Series:
    return pd.to_datetime(series, errors="coerce", dayfirst=True).dt.date


def _cast_timestamp(series: pd.Series) -> pd.Series:
    return pd.to_datetime(series, errors="coerce", dayfirst=True, utc=True)


def _cast_text(series: pd.Series) -> pd.Series:
    casted = series.map(lambda x: x.strip() if isinstance(x, str) else x)
    casted = casted.replace({"": pd.NA})
    return casted


@dataclass
class CastResult:
    frame: pd.DataFrame
    rejections: pd.DataFrame


def apply_type_casts(
    frame: pd.DataFrame,
    table_name: str,
    types_mapping: dict[str, str],
) -> CastResult:
    casted = frame.copy()
    rejection_records: list[dict[str, Any]] = []

    for column, desired_type in types_mapping.items():
        if column not in casted.columns:
            continue

        source_series = casted[column]

        lowered = desired_type.lower()
        if lowered in {"text", "varchar", "string"}:
            converted = _cast_text(source_series)
        elif lowered in {"int", "integer", "bigint"}:
            converted = _cast_integer(source_series)
        elif lowered in {"float", "double", "numeric", "decimal"}:
            converted = _cast_numeric(source_series)
        elif lowered in {"date"}:
            converted = _cast_date(source_series)
        elif lowered in {"timestamp", "timestamptz", "datetime"}:
            converted = _cast_timestamp(source_series)
        elif lowered in {"bool", "boolean"}:
            converted = source_series.map(lambda v: None if pd.isna(v) else str(v).strip().lower())
            converted = converted.map(
                lambda v: (
                    True
                    if v in {"1", "true", "t", "yes", "y", "sim"}
                    else False
                    if v in {"0", "false", "f", "no", "n", "nao", "não"}
                    else None
                )
            ).astype("boolean")
        else:
            continue

        invalid_mask = source_series.notna() & converted.isna()
        for idx in casted.index[invalid_mask]:
            row = casted.loc[idx]
            rejection_records.append(
                {
                    "table_name": table_name,
                    "source_row_number": int(row.get("source_row_number") or 0),
                    "reason_code": "type_cast_error",
                    "reason_detail": f"Invalid value for column '{column}' as {desired_type}",
                    "payload": _safe_payload(row),
                }
            )

        casted[column] = converted

    rejections = pd.DataFrame(rejection_records)
    return CastResult(frame=casted, rejections=rejections)
