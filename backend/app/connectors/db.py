from __future__ import annotations

from contextlib import contextmanager
from dataclasses import dataclass

from sqlalchemy import create_engine, text
from sqlalchemy.engine import Engine, URL

from app.config.models import DbCredentials
from app.utils.timezone import DB_TIMEZONE

ADVISORY_LOCK_KEY = 90210077


@dataclass(frozen=True)
class HealthcheckResult:
    ok: bool
    details: dict[str, str]


def build_db_url(creds: DbCredentials) -> URL:
    return URL.create(
        drivername="postgresql+psycopg2",
        username=creds.user,
        password=creds.password,
        host=creds.host,
        port=creds.port,
        database=creds.dbname,
    )


def create_db_engine(
    creds: DbCredentials,
    connect_timeout_seconds: int,
    statement_timeout_seconds: int,
) -> Engine:
    options = (
        f"-c statement_timeout={statement_timeout_seconds * 1000} "
        f"-c TimeZone={DB_TIMEZONE}"
    )
    return create_engine(
        build_db_url(creds),
        pool_pre_ping=True,
        future=True,
        connect_args={
            "connect_timeout": connect_timeout_seconds,
            "options": options,
        },
    )


def run_healthcheck(engine: Engine) -> HealthcheckResult:
    details: dict[str, str] = {}
    with engine.begin() as conn:
        details["server_time_brasilia"] = str(conn.execute(text("select now()")).scalar_one())

        for schema in ("app", "staging", "audit", "authz"):
            exists = conn.execute(
                text("select exists(select 1 from information_schema.schemata where schema_name = :schema)"),
                {"schema": schema},
            ).scalar_one()
            details[f"schema_{schema}"] = "ok" if exists else "missing"

        usage = conn.execute(
            text("select has_schema_privilege('authenticated', 'app', 'USAGE')")
        ).scalar_one()
        details["authenticated_schema_usage_app"] = "ok" if usage else "missing_grant"

        table_select = conn.execute(
            text("select has_table_privilege('authenticated', 'app.db_barras', 'SELECT')")
        ).scalar_one()
        details["authenticated_select_db_barras"] = "ok" if table_select else "missing_grant"

    ok = all(value == "ok" or key == "server_time_brasilia" for key, value in details.items())
    return HealthcheckResult(ok=ok, details=details)


def acquire_sync_lock(engine: Engine) -> bool:
    with engine.begin() as conn:
        return bool(
            conn.execute(
                text("select pg_try_advisory_lock(:lock_key)"),
                {"lock_key": ADVISORY_LOCK_KEY},
            ).scalar_one()
        )


def release_sync_lock(engine: Engine) -> None:
    with engine.begin() as conn:
        conn.execute(
            text("select pg_advisory_unlock(:lock_key)"),
            {"lock_key": ADVISORY_LOCK_KEY},
        )


@contextmanager
def advisory_lock(engine: Engine):
    lock_ok = acquire_sync_lock(engine)
    if not lock_ok:
        raise RuntimeError("Another sync process is already running (advisory lock in use)")
    try:
        yield
    finally:
        release_sync_lock(engine)
