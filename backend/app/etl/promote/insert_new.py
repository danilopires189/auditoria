from __future__ import annotations

import re

from sqlalchemy import text
from sqlalchemy.engine import Engine

IDENTIFIER_RE = re.compile(r"^[a-z_][a-z0-9_]*$")


def _validate_identifier(value: str) -> None:
    if not IDENTIFIER_RE.match(value):
        raise ValueError(f"Invalid SQL identifier: {value}")


def promote_insert_new(
    engine: Engine,
    table_name: str,
    business_columns: list[str],
    run_id: str,
) -> int:
    _validate_identifier(table_name)
    for col in business_columns:
        _validate_identifier(col)

    quoted_insert_cols = ", ".join(f'"{col}"' for col in [*business_columns, "source_run_id", "updated_at"])
    select_business_cols = ", ".join(f's."{col}"' for col in business_columns)

    row_match = " and ".join(
        f't."{col}" is not distinct from s."{col}"'
        for col in business_columns
    )

    sql = text(
        f"""
        with inserted as (
            insert into app."{table_name}" ({quoted_insert_cols})
            select {select_business_cols}, :run_id, now()
            from staging."{table_name}" s
            where s.run_id = :run_id
              and not exists (
                  select 1
                  from app."{table_name}" t
                  where {row_match}
              )
            returning 1
        )
        select count(*) from inserted
        """
    )

    with engine.begin() as conn:
        inserted_rows = conn.execute(sql, {"run_id": run_id}).scalar_one()

    return int(inserted_rows)
