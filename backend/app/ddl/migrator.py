from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

from sqlalchemy.engine import Engine

from app.utils.hashers import sha256_file


@dataclass
class MigrationResult:
    version: str
    filename: str
    applied: bool


def _ensure_migration_table(engine: Engine) -> None:
    sql = """
    create table if not exists public.schema_migrations (
        version text primary key,
        filename text not null,
        checksum text not null,
        applied_at timestamptz not null default now()
    )
    """
    with engine.begin() as conn:
        conn.exec_driver_sql(sql)


def _read_applied(engine: Engine) -> dict[str, str]:
    with engine.begin() as conn:
        rows = conn.exec_driver_sql(
            "select version, checksum from public.schema_migrations"
        ).fetchall()
    return {row[0]: row[1] for row in rows}


def apply_migrations(engine: Engine, sql_dir: Path) -> list[MigrationResult]:
    if not sql_dir.exists():
        raise FileNotFoundError(f"SQL migrations directory not found: {sql_dir}")

    _ensure_migration_table(engine)
    applied = _read_applied(engine)
    results: list[MigrationResult] = []

    migration_files = sorted(sql_dir.glob("V*.sql"), key=lambda path: path.name)

    for file_path in migration_files:
        version = file_path.name.split("__", 1)[0]
        checksum = sha256_file(file_path)

        if version in applied:
            if applied[version] != checksum:
                raise RuntimeError(
                    f"Migration checksum mismatch for {file_path.name}. "
                    "Create a new versioned migration instead of editing applied files."
                )
            results.append(
                MigrationResult(version=version, filename=file_path.name, applied=False)
            )
            continue

        sql_payload = file_path.read_text(encoding="utf-8")
        with engine.begin() as conn:
            dbapi_conn = conn.connection
            if hasattr(dbapi_conn, "driver_connection"):
                dbapi_conn = dbapi_conn.driver_connection
            with dbapi_conn.cursor() as cursor:
                cursor.execute(sql_payload)
            conn.exec_driver_sql(
                """
                insert into public.schema_migrations(version, filename, checksum)
                values (%(version)s, %(filename)s, %(checksum)s)
                """,
                {
                    "version": version,
                    "filename": file_path.name,
                    "checksum": checksum,
                },
            )

        results.append(MigrationResult(version=version, filename=file_path.name, applied=True))

    return results
