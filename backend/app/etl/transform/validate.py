from __future__ import annotations

from dataclasses import dataclass
from typing import Any

import pandas as pd

from app.etl.transform.dedupe import deduplicate_frame
from app.utils.json_safe import to_json_safe

MAX_DETAILED_DUPLICATE_REJECTIONS = 200


@dataclass
class ValidationOutcome:
    valid_frame: pd.DataFrame
    rejections: pd.DataFrame
    rows_in: int
    rows_out: int


def _safe_payload(row: pd.Series) -> dict[str, Any]:
    payload: dict[str, Any] = {}
    for key, value in row.items():
        if pd.isna(value):
            payload[key] = None
        else:
            payload[key] = to_json_safe(value)
    return payload


def validate_frame(
    table_name: str,
    frame: pd.DataFrame,
    required_columns: list[str],
    unique_keys: list[str],
    dedupe_order_by: list[str] | None = None,
) -> ValidationOutcome:
    for col in required_columns:
        if col not in frame.columns:
            raise ValueError(f"[{table_name}] required column missing: {col}")

    rows_in = len(frame)
    rejection_records: list[dict[str, Any]] = []

    valid_mask = pd.Series(True, index=frame.index)
    if required_columns:
        missing_matrix = frame[required_columns].isna()
        missing_any = missing_matrix.any(axis=1)
        for idx in frame.index[missing_any]:
            row = frame.loc[idx]
            missing_cols = [col for col in required_columns if bool(missing_matrix.loc[idx, col])]
            rejection_records.append(
                {
                    "table_name": table_name,
                    "source_row_number": int(row.get("source_row_number") or 0),
                    "reason_code": "required_null",
                    "reason_detail": f"Required columns null: {', '.join(missing_cols)}",
                    "payload": _safe_payload(row),
                }
            )
        valid_mask = valid_mask & ~missing_any

    valid_frame = frame.loc[valid_mask].copy()

    if unique_keys:
        for key in unique_keys:
            if key not in valid_frame.columns:
                raise ValueError(f"[{table_name}] unique key column missing: {key}")

    dedupe_result = deduplicate_frame(valid_frame, unique_keys, dedupe_order_by)
    duplicates = dedupe_result.duplicates
    valid_frame = dedupe_result.frame

    if not duplicates.empty:
        detailed_duplicates = duplicates
        skipped_duplicates = 0
        if len(duplicates) > MAX_DETAILED_DUPLICATE_REJECTIONS:
            detailed_duplicates = duplicates.head(MAX_DETAILED_DUPLICATE_REJECTIONS)
            skipped_duplicates = len(duplicates) - len(detailed_duplicates)

        for _, row in detailed_duplicates.iterrows():
            rejection_records.append(
                {
                    "table_name": table_name,
                    "source_row_number": int(row.get("source_row_number") or 0),
                    "reason_code": "duplicate_unique_key",
                    "reason_detail": f"Duplicate row for unique keys {unique_keys}; kept last occurrence",
                    "payload": _safe_payload(row),
                }
            )
        if skipped_duplicates > 0:
            rejection_records.append(
                {
                    "table_name": table_name,
                    "source_row_number": 0,
                    "reason_code": "duplicate_unique_key_summary",
                    "reason_detail": (
                        f"Suppressed {skipped_duplicates} duplicate rows "
                        f"for unique keys {unique_keys}"
                    ),
                    "payload": {
                        "total_duplicates": int(len(duplicates)),
                        "detailed_reported": int(len(detailed_duplicates)),
                        "suppressed": int(skipped_duplicates),
                    },
                }
            )

    rejections = pd.DataFrame(rejection_records)
    rows_out = len(valid_frame)
    return ValidationOutcome(
        valid_frame=valid_frame,
        rejections=rejections,
        rows_in=rows_in,
        rows_out=rows_out,
    )
