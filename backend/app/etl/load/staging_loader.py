from __future__ import annotations

from io import StringIO
import time

import pandas as pd
from sqlalchemy import text
from sqlalchemy.engine import Engine

from app.utils.timezone import now_brasilia

COPY_CHUNK_ROWS = 100_000
COPY_MAX_ATTEMPTS = 2


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
    # Kept for compatibility with current sync flow; cleanup is table-wide now.
    _ = run_id
    clear_staging_for_table(engine, table_name)


def clear_staging_for_table(engine: Engine, table_name: str) -> None:
    with engine.begin() as conn:
        conn.execute(text(f'truncate table staging."{table_name}"'))


def _is_transient_copy_error(exc: Exception) -> bool:
    message = str(exc).lower()
    transient_tokens = (
        "server closed the connection unexpectedly",
        "connection already closed",
        "invalid socket",
        "could not receive data from server",
        "terminating connection",
        "connection not open",
    )
    return any(token in message for token in transient_tokens)


def _copy_in_chunks(
    data: pd.DataFrame,
    copy_sql: str,
    cursor,
) -> None:
    for start in range(0, len(data), COPY_CHUNK_ROWS):
        chunk = data.iloc[start : start + COPY_CHUNK_ROWS]
        csv_buffer = StringIO()
        chunk.to_csv(csv_buffer, index=False, header=False, na_rep="\\N")
        csv_buffer.seek(0)
        cursor.copy_expert(copy_sql, csv_buffer)


def load_dataframe_to_staging(
    engine: Engine,
    table_name: str,
    frame: pd.DataFrame,
    run_id: str,
) -> int:
    # Staging is transient per load cycle; always start from a clean table.
    clear_staging_for_table(engine, table_name)

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

    quoted_cols = ", ".join(_quoted(col) for col in columns)
    copy_sql = (
        f'COPY staging."{table_name}" ({quoted_cols}) '
        "FROM STDIN WITH (FORMAT CSV, NULL '\\N')"
    )

    last_exc: Exception | None = None
    for attempt in range(1, COPY_MAX_ATTEMPTS + 1):
        raw_conn = engine.raw_connection()
        try:
            with raw_conn.cursor() as cursor:
                _copy_in_chunks(data, copy_sql, cursor)
            raw_conn.commit()
            last_exc = None
            break
        except Exception as exc:
            last_exc = exc
            try:
                if not getattr(raw_conn, "closed", False):
                    raw_conn.rollback()
            except Exception:
                pass

            can_retry = attempt < COPY_MAX_ATTEMPTS and _is_transient_copy_error(exc)
            if can_retry:
                time.sleep(2)
                continue
            raise
        finally:
            try:
                raw_conn.close()
            except Exception:
                pass

    if last_exc is not None:
        raise last_exc

    return len(data)
