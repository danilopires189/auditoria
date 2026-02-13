from __future__ import annotations

from dataclasses import dataclass

import pandas as pd


@dataclass
class DeduplicationResult:
    frame: pd.DataFrame
    duplicates: pd.DataFrame


def deduplicate_frame(
    frame: pd.DataFrame,
    unique_keys: list[str],
    order_by: list[str] | None = None,
) -> DeduplicationResult:
    if not unique_keys:
        return DeduplicationResult(frame=frame, duplicates=frame.iloc[0:0].copy())

    work = frame.copy()
    effective_order = [col for col in (order_by or []) if col in work.columns]
    if effective_order:
        work = work.sort_values(effective_order, kind="stable")

    duplicate_mask = work.duplicated(subset=unique_keys, keep="last")
    duplicates = work.loc[duplicate_mask].copy()
    deduped = work.loc[~duplicate_mask].copy()

    return DeduplicationResult(frame=deduped, duplicates=duplicates)