from __future__ import annotations

from typing import Any

import pandas as pd


def _relocalize_utc_series_to_brasilia(series: pd.Series) -> tuple[pd.Series, int]:
    non_null_count = int(series.notna().sum())
    if non_null_count == 0:
        return series, 0

    adjusted = series.dt.tz_localize(None).dt.tz_localize("America/Sao_Paulo")
    return adjusted, non_null_count


def _drop_db_usuario_empty_cd_duplicates(
    frame: pd.DataFrame,
) -> tuple[pd.DataFrame, dict[str, int]]:
    if "mat" not in frame.columns or "cd" not in frame.columns:
        return frame, {"dropped_empty_cd_duplicate_mat": 0}

    work = frame.copy()
    normalized_mat = work["mat"].astype("string").str.strip()
    valid_mat_mask = normalized_mat.notna() & normalized_mat.ne("")
    keepable_mats = normalized_mat[valid_mat_mask & work["cd"].notna()].drop_duplicates()

    if keepable_mats.empty:
        return work, {"dropped_empty_cd_duplicate_mat": 0}

    drop_mask = valid_mat_mask & work["cd"].isna() & normalized_mat.isin(keepable_mats)
    dropped_count = int(drop_mask.sum())
    if dropped_count == 0:
        return work, {"dropped_empty_cd_duplicate_mat": 0}

    return (
        work.loc[~drop_mask].copy(),
        {"dropped_empty_cd_duplicate_mat": dropped_count},
    )


def _prepare_db_prod_vol_compat_columns(
    frame: pd.DataFrame,
) -> tuple[pd.DataFrame, dict[str, int]]:
    work = frame.copy()
    populated_aud_from_usuario = 0
    relocalized_timestamp_columns: dict[str, int] = {}

    if "usuario" in work.columns:
        usuario = work["usuario"].astype("string").str.strip().replace({"": pd.NA})
        work["usuario"] = usuario

        if "aud" not in work.columns:
            work["aud"] = usuario
            populated_aud_from_usuario = int(usuario.notna().sum())
        else:
            aud = work["aud"].astype("string").str.strip().replace({"": pd.NA})
            fill_mask = aud.isna() & usuario.notna()
            populated_aud_from_usuario = int(fill_mask.sum())
            aud.loc[fill_mask] = usuario.loc[fill_mask]
            work["aud"] = aud

    if "aud" in work.columns:
        work["aud"] = work["aud"].astype("string").str.strip().replace({"": pd.NA})

    for column in ("dt_ped", "dt_lib", "encerramento"):
        if column not in work.columns:
            continue
        series = work[column]
        if not pd.api.types.is_datetime64tz_dtype(series):
            continue
        work[column], adjusted_count = _relocalize_utc_series_to_brasilia(series)
        relocalized_timestamp_columns[column] = adjusted_count

    return work, {
        "populated_aud_from_usuario": populated_aud_from_usuario,
        "relocalized_timestamp_columns": relocalized_timestamp_columns,
    }


def apply_table_specific_rules(
    table_name: str,
    frame: pd.DataFrame,
) -> tuple[pd.DataFrame, dict[str, Any]]:
    if table_name == "db_usuario":
        return _drop_db_usuario_empty_cd_duplicates(frame)
    if table_name == "db_prod_vol":
        return _prepare_db_prod_vol_compat_columns(frame)

    return frame, {}
