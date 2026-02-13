from __future__ import annotations

import re
from typing import Any

from sqlalchemy import text
from sqlalchemy.engine import Engine

IDENTIFIER_RE = re.compile(r"^[a-z_][a-z0-9_]*$")


def _validate_identifier(value: str) -> None:
    if not IDENTIFIER_RE.match(value):
        raise ValueError(f"Invalid SQL identifier: {value}")


def promote_upsert(
    engine: Engine,
    table_name: str,
    business_columns: list[str],
    unique_keys: list[str],
    run_id: str,
    additional_filter_sql: str = "",
    additional_params: dict[str, Any] | None = None,
) -> int:
    _validate_identifier(table_name)
    for col in business_columns + unique_keys:
        _validate_identifier(col)

    if not unique_keys:
        raise ValueError(f"[{table_name}] upsert requires unique_keys")

    extra_params = additional_params or {}

    insert_cols = business_columns + ["source_run_id", "updated_at"]
    quoted_insert_cols = ", ".join(f'"{col}"' for col in insert_cols)
    select_business_cols = ", ".join(f's."{col}"' for col in business_columns)

    where_clause = "s.run_id = :run_id"
    if additional_filter_sql:
        where_clause = f"{where_clause} and ({additional_filter_sql})"

    conflict_cols = ", ".join(f'"{col}"' for col in unique_keys)

    update_cols = [col for col in business_columns if col not in unique_keys]
    set_assignments = [f'"{col}" = EXCLUDED."{col}"' for col in update_cols]
    set_assignments.extend(
        [
            '"source_run_id" = EXCLUDED."source_run_id"',
            '"updated_at" = EXCLUDED."updated_at"',
        ]
    )
    set_clause = ", ".join(set_assignments)

    distinct_predicates = [
        f'app."{table_name}"."{col}" is distinct from EXCLUDED."{col}"'
        for col in update_cols
    ]
    distinct_clause = " or ".join(distinct_predicates) if distinct_predicates else "false"

    sql = f"""
    insert into app."{table_name}" ({quoted_insert_cols})
    select {select_business_cols}, :run_id, now()
    from staging."{table_name}" s
    where {where_clause}
    on conflict ({conflict_cols}) do update
    set {set_clause}
    where {distinct_clause}
    """

    params = {"run_id": run_id, **extra_params}
    with engine.begin() as conn:
        conn.execute(text(sql), params)
        promoted_rows = conn.execute(
            text(
                f"""
                select count(*)
                from staging."{table_name}" s
                where {where_clause}
                """
            ),
            params,
        ).scalar_one()

    return int(promoted_rows)
