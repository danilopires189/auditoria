from __future__ import annotations

from io import StringIO

import pandas as pd
from sqlalchemy import text
from sqlalchemy.engine import Engine

from app.utils.timezone import now_brasilia


def _quoted(identifier: str) -> str:
    return f'"{identifier}"'


def get_table_columns(engine: Engine, schema: str, table_name: str) -> list[str]:
    sql = text(
        """
        select column_name
        from information_schema.columns
        where table_schema = :schema and table_name = :table_name
        order by ordinal_position
        """
    )
    with engine.begin() as conn:
        rows = conn.execute(sql, {"schema": schema, "table_name": table_name}).fetchall()
    if not rows:
        raise ValueError(f"Table not found: {schema}.{table_name}")
    return [row[0] for row in rows]


def clear_staging_for_run(engine: Engine, table_name: str, run_id: str) -> None:
    with engine.begin() as conn:
        conn.execute(
            text(f'delete from staging."{table_name}" where run_id = :run_id'),
            {"run_id": run_id},
        )


def clear_staging_for_table(engine: Engine, table_name: str) -> None:
    with engine.begin() as conn:
        conn.execute(text(f'truncate table staging."{table_name}"'))


def load_dataframe_to_staging(
    engine: Engine,
    table_name: str,
    frame: pd.DataFrame,
    run_id: str,
) -> int:
    if frame.empty:
        return 0

    columns = get_table_columns(engine, "staging", table_name)
    data = frame.copy()
    data["run_id"] = run_id
    if "source_file" not in data.columns:
        data["source_file"] = None
    if "source_row_number" not in data.columns:
        data["source_row_number"] = None
    data["ingested_at"] = now_brasilia()

    for col in columns:
        if col not in data.columns:
            data[col] = None

    data = data[columns]

    csv_buffer = StringIO()
    data.to_csv(csv_buffer, index=False, header=False, na_rep="\\N")
    csv_buffer.seek(0)

    quoted_cols = ", ".join(_quoted(col) for col in columns)
    copy_sql = (
        f'COPY staging."{table_name}" ({quoted_cols}) '
        "FROM STDIN WITH (FORMAT CSV, NULL '\\N')"
    )

    raw_conn = engine.raw_connection()
    try:
        with raw_conn.cursor() as cursor:
            cursor.copy_expert(copy_sql, csv_buffer)
        raw_conn.commit()
    except Exception:
        raw_conn.rollback()
        raise
    finally:
        raw_conn.close()

    return len(data)
