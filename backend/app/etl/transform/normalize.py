from __future__ import annotations

import re
import unicodedata

import pandas as pd

ALIAS_MAP = {
    "desc": "descricao",
    "descricao": "descricao",
    "vl_tt": "vl_tt",
}


def snake_case(value: str) -> str:
    normalized = unicodedata.normalize("NFKD", value)
    normalized = normalized.encode("ascii", "ignore").decode("ascii")
    normalized = normalized.replace("\u00a0", " ")
    normalized = normalized.strip().lower()
    normalized = re.sub(r"[^a-z0-9]+", "_", normalized)
    normalized = re.sub(r"_+", "_", normalized).strip("_")
    if not normalized:
        return ""
    if normalized[0].isdigit():
        return f"col_{normalized}"
    return normalized


def normalize_headers(frame: pd.DataFrame) -> tuple[pd.DataFrame, list[str]]:
    renamed: list[str] = []
    dropped: list[str] = []

    for index, original in enumerate(frame.columns):
        normalized = snake_case(str(original))
        if not normalized or normalized.startswith("unnamed"):
            normalized = f"__drop_col_{index}"
            dropped.append(str(original))
        normalized = ALIAS_MAP.get(normalized, normalized)
        renamed.append(normalized)

    frame = frame.copy()
    frame.columns = renamed

    merged = pd.DataFrame(index=frame.index)
    for col in frame.columns:
        if col.startswith("__drop_col_"):
            continue
        candidate = frame[col]
        if isinstance(candidate, pd.DataFrame):
            candidate = candidate.bfill(axis=1).iloc[:, 0]
        if col in merged.columns:
            merged[col] = merged[col].combine_first(candidate)
        else:
            merged[col] = candidate

    return merged, dropped


def normalize_text_values(frame: pd.DataFrame) -> pd.DataFrame:
    normalized = frame.copy()
    object_cols = normalized.select_dtypes(include=["object"]).columns
    for col in object_cols:
        normalized[col] = (
            normalized[col]
            .map(lambda x: x.replace("\u00a0", " ") if isinstance(x, str) else x)
            .map(lambda x: x.strip() if isinstance(x, str) else x)
        )
        normalized[col] = normalized[col].replace({"": pd.NA})
    return normalized


def normalize_dataframe(frame: pd.DataFrame) -> tuple[pd.DataFrame, list[str]]:
    normalized, dropped = normalize_headers(frame)
    normalized = normalize_text_values(normalized)
    return normalized, dropped
