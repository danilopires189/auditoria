from __future__ import annotations

from pathlib import Path

import typer

from app.config.loader import load_runtime_config
from app.connectors.db import create_db_engine, run_healthcheck
from app.sync_service import SyncService
from app.utils.logging import configure_logging, get_logger

cli = typer.Typer(add_completion=False, no_args_is_help=True)


def _exit_with_error(exc: Exception) -> None:
    logger = get_logger()
    logger.exception("command failed")
    typer.echo(f"ERROR: {exc}")
    raise typer.Exit(code=1)


def _build_service(config: str, env_file: str) -> SyncService:
    runtime = load_runtime_config(config, env_file)
    configure_logging(runtime.app.log_level, runtime.config_path.parent / "logs")

    engine = create_db_engine(
        runtime.db,
        connect_timeout_seconds=runtime.supabase.connect_timeout_seconds,
        statement_timeout_seconds=runtime.supabase.statement_timeout_seconds,
    )
    return SyncService(engine=engine, config=runtime)


@cli.command("bootstrap")
def bootstrap_command(
    config: str = typer.Option("config.yml", "--config", help="Path to config.yml"),
    env_file: str = typer.Option(".env", "--env-file", help="Path to .env"),
) -> None:
    try:
        service = _build_service(config, env_file)
        result = service.bootstrap()
        typer.echo(f"run_id={result.run_id} status={result.status} message={result.message}")
    except Exception as exc:
        _exit_with_error(exc)


@cli.command("refresh")
def refresh_command(
    config: str = typer.Option("config.yml", "--config", help="Path to config.yml"),
    env_file: str = typer.Option(".env", "--env-file", help="Path to .env"),
) -> None:
    try:
        service = _build_service(config, env_file)
        result = service.refresh_only()
        typer.echo(f"run_id={result.run_id} status={result.status} message={result.message}")
    except Exception as exc:
        _exit_with_error(exc)


@cli.command("validate")
def validate_command(
    config: str = typer.Option("config.yml", "--config", help="Path to config.yml"),
    env_file: str = typer.Option(".env", "--env-file", help="Path to .env"),
) -> None:
    try:
        service = _build_service(config, env_file)
        result = service.validate_only()
        typer.echo(f"run_id={result.run_id} status={result.status} message={result.message}")
    except Exception as exc:
        _exit_with_error(exc)


@cli.command("sync")
def sync_command(
    config: str = typer.Option("config.yml", "--config", help="Path to config.yml"),
    env_file: str = typer.Option(".env", "--env-file", help="Path to .env"),
) -> None:
    try:
        service = _build_service(config, env_file)
        result = service.sync(dry_run=False)
        typer.echo(f"run_id={result.run_id} status={result.status} message={result.message}")
    except Exception as exc:
        _exit_with_error(exc)


@cli.command("dry-run")
def dry_run_command(
    config: str = typer.Option("config.yml", "--config", help="Path to config.yml"),
    env_file: str = typer.Option(".env", "--env-file", help="Path to .env"),
) -> None:
    try:
        service = _build_service(config, env_file)
        result = service.sync(dry_run=True)
        typer.echo(f"run_id={result.run_id} status={result.status} message={result.message}")
    except Exception as exc:
        _exit_with_error(exc)


@cli.command("healthcheck")
def healthcheck_command(
    config: str = typer.Option("config.yml", "--config", help="Path to config.yml"),
    env_file: str = typer.Option(".env", "--env-file", help="Path to .env"),
) -> None:
    try:
        runtime = load_runtime_config(config, env_file)
        configure_logging(runtime.app.log_level, runtime.config_path.parent / "logs")

        engine = create_db_engine(
            runtime.db,
            connect_timeout_seconds=runtime.supabase.connect_timeout_seconds,
            statement_timeout_seconds=runtime.supabase.statement_timeout_seconds,
        )

        result = run_healthcheck(engine)
        logger = get_logger()
        logger.info("healthcheck_result={} details={}", result.ok, result.details)

        if not result.ok:
            for key, value in result.details.items():
                typer.echo(f"{key}={value}")
            raise typer.Exit(code=1)

        for key, value in result.details.items():
            typer.echo(f"{key}={value}")
    except typer.Exit:
        raise
    except Exception as exc:
        _exit_with_error(exc)


def run() -> None:
    cli()
