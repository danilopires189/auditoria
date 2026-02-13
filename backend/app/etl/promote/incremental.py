from __future__ import annotations

from datetime import timedelta
import re

from sqlalchemy import text
from sqlalchemy.engine import Engine

from app.etl.promote.upsert import promote_upsert

IDENTIFIER_RE = re.compile(r"^[a-z_][a-z0-9_]*$")


def _validate_identifier(value: str) -> None:
    if not IDENTIFIER_RE.match(value):
        raise ValueError(f"Invalid SQL identifier: {value}")


def promote_incremental(
    engine: Engine,
    table_name: str,
    business_columns: list[str],
    unique_keys: list[str],
    run_id: str,
    watermark_column: str,
    lookback_days: int,
) -> tuple[int, str | None, str | None]:
    _validate_identifier(table_name)
    _validate_identifier(watermark_column)
    for col in business_columns + unique_keys:
        _validate_identifier(col)

    with engine.begin() as conn:
        current_max = conn.execute(
            text(f'select max("{watermark_column}") from app."{table_name}"')
        ).scalar_one()
        incoming_max = conn.execute(
            text(
                f"""
                select max(s."{watermark_column}")
                from staging."{table_name}" s
                where s.run_id = :run_id
                """
            ),
            {"run_id": run_id},
        ).scalar_one()

    cutoff_value = None
    cutoff = None
    if current_max is not None:
        cutoff = current_max - timedelta(days=lookback_days)
        cutoff_value = cutoff.isoformat()

    if unique_keys:
        if cutoff is not None:
            promoted_rows = promote_upsert(
                engine=engine,
                table_name=table_name,
                business_columns=business_columns,
                unique_keys=unique_keys,
                run_id=run_id,
                additional_filter_sql=f's."{watermark_column}" >= :cutoff',
                additional_params={"cutoff": cutoff},
            )
        else:
            promoted_rows = promote_upsert(
                engine=engine,
                table_name=table_name,
                business_columns=business_columns,
                unique_keys=unique_keys,
                run_id=run_id,
            )
        incoming_max_iso = incoming_max.isoformat() if incoming_max is not None else None
        return promoted_rows, cutoff_value, incoming_max_iso

    # Incremental sem unique_keys: replace por janela para preservar todas as linhas do período.
    quoted_insert_cols = ", ".join(f'"{col}"' for col in [*business_columns, "source_run_id", "updated_at"])
    select_business_cols = ", ".join(f's."{col}"' for col in business_columns)

    where_clause = "s.run_id = :run_id"
    params: dict[str, object] = {"run_id": run_id}
    if cutoff is not None:
        where_clause = f'{where_clause} and s."{watermark_column}" >= :cutoff'
        params["cutoff"] = cutoff

    insert_sql = text(
        f"""
        insert into app."{table_name}" ({quoted_insert_cols})
        select {select_business_cols}, :run_id, now()
        from staging."{table_name}" s
        where {where_clause}
        """
    )
    count_sql = text(
        f"""
        select count(*)
        from staging."{table_name}" s
        where {where_clause}
        """
    )

    with engine.begin() as conn:
        if cutoff is not None:
            conn.execute(
                text(f'delete from app."{table_name}" where "{watermark_column}" >= :cutoff'),
                {"cutoff": cutoff},
            )
        conn.execute(insert_sql, params)
        promoted_rows = conn.execute(count_sql, params).scalar_one()

    incoming_max_iso = incoming_max.isoformat() if incoming_max is not None else None
    return int(promoted_rows), cutoff_value, incoming_max_iso
