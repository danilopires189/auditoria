from __future__ import annotations

import re

from sqlalchemy import text
from sqlalchemy.engine import Engine

IDENTIFIER_RE = re.compile(r"^[a-z_][a-z0-9_]*$")


def _validate_identifier(value: str) -> None:
    if not IDENTIFIER_RE.match(value):
        raise ValueError(f"Invalid SQL identifier: {value}")


def _bounded_name(prefix: str, table_name: str, run_id: str) -> str:
    token = run_id.replace("-", "")[:8]
    name = f"{prefix}_{table_name}_{token}"
    if len(name) <= 63:
        return name
    suffix = f"_{token}"
    max_table_len = 63 - len(prefix) - len(suffix) - 1
    return f"{prefix}_{table_name[:max_table_len]}{suffix}"


def promote_full_replace(
    engine: Engine,
    table_name: str,
    business_columns: list[str],
    run_id: str,
) -> int:
    _validate_identifier(table_name)
    for col in business_columns:
        _validate_identifier(col)

    swap_table = _bounded_name("__swap", table_name, run_id)
    old_table = _bounded_name("__old", table_name, run_id)

    quoted_business = ", ".join(f'"{col}"' for col in business_columns)
    quoted_target = ", ".join(
        [quoted_business, '"source_run_id"', '"updated_at"']
    )
    select_source = ", ".join(f's."{col}"' for col in business_columns)

    with engine.begin() as conn:
        conn.execute(text(f'drop table if exists app."{swap_table}"'))
        conn.execute(
            text(
                f'create table app."{swap_table}" '
                f'(like app."{table_name}" including all)'
            )
        )

        conn.execute(
            text(
                f"""
                insert into app."{swap_table}" ({quoted_target})
                select {select_source}, :run_id, now()
                from staging."{table_name}" s
                where s.run_id = :run_id
                """
            ),
            {"run_id": run_id},
        )

        conn.execute(text(f'alter table app."{table_name}" rename to "{old_table}"'))
        conn.execute(text(f'alter table app."{swap_table}" rename to "{table_name}"'))
        conn.execute(text("select app.apply_runtime_security(:table_name)"), {"table_name": table_name})
        conn.execute(text(f'drop table app."{old_table}"'))

        rows_out = conn.execute(
            text(f'select count(*) from app."{table_name}"')
        ).scalar_one()

    with engine.begin() as conn:
        conn.execute(text(f'analyze app."{table_name}"'))

    return int(rows_out)
