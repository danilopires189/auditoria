from __future__ import annotations

from pathlib import Path

import pandas as pd

from app.config.models import TableConfig


def read_source_dataframe(table_name: str, table_cfg: TableConfig, data_dir: Path) -> pd.DataFrame:
    source_path = data_dir / table_cfg.file
    if not source_path.exists():
        raise FileNotFoundError(f"[{table_name}] source file not found: {source_path}")

    suffix = source_path.suffix.lower()
    if suffix in {".xlsx", ".xlsm", ".xls"}:
        if not table_cfg.sheet:
            raise ValueError(f"[{table_name}] sheet is required for Excel files")
        frame = pd.read_excel(
            source_path,
            sheet_name=table_cfg.sheet,
            engine="openpyxl",
            dtype=object,
        )
    elif suffix == ".csv":
        frame = pd.read_csv(source_path, dtype=object)
    elif suffix == ".parquet":
        frame = pd.read_parquet(source_path)
        frame = frame.astype(object)
    else:
        raise ValueError(f"[{table_name}] unsupported extension: {suffix}")

    frame = frame.copy()
    frame["source_file"] = source_path.name
    frame["source_row_number"] = range(2, len(frame) + 2)
    return frame