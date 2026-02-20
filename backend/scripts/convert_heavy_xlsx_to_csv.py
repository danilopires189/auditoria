from __future__ import annotations

from pathlib import Path
from time import perf_counter

import pandas as pd


SOURCES: tuple[tuple[str, str, str, list[str]], ...] = (
    ("BD_END.xlsx", "DB_END", "BD_END.csv", ["CD", "CODDV", "DESC", "ENDERECO", "ANDAR", "VALIDADE", "TIPO"]),
    (
        "DB_ESTQ_ENTR.xlsx",
        "DB_ESTQ_ENTR",
        "DB_ESTQ_ENTR.csv",
        ["CD", "CODDV", "QTD_EST_ATUAL", "QTD_EST_DISP", "DAT_ULT_COMPRA"],
    ),
    ("DB_LOG_END.xlsx", "DB_LOG_END", "DB_LOG_END.csv", ["CD", "CODDV", "ENDERECO", "EXCLUSAO"]),
)


def convert_one(data_dir: Path, source_file: str, sheet: str, target_file: str, usecols: list[str]) -> None:
    source = data_dir / source_file
    target = data_dir / target_file
    if not source.exists():
        raise FileNotFoundError(f"Source file not found: {source}")

    start = perf_counter()
    frame = pd.read_excel(source, sheet_name=sheet, dtype=object, engine="openpyxl", usecols=usecols)
    frame.to_csv(target, index=False, encoding="utf-8")
    elapsed = perf_counter() - start
    print(f"{source_file} -> {target_file}: rows={len(frame)} elapsed={elapsed:.2f}s")


def main() -> None:
    root = Path(__file__).resolve().parents[1]
    data_dir = root / "data"
    for source_file, sheet, target_file, usecols in SOURCES:
        convert_one(data_dir, source_file, sheet, target_file, usecols)


if __name__ == "__main__":
    main()
