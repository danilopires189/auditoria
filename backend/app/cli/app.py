from __future__ import annotations

import typer

from app.automation.edge_sync import edge_healthcheck, is_edge_transport_enabled
from app.automation.runner import AutomationRunner
from app.automation.task_scheduler import (
    install_or_update_task,
    query_task_status,
    remove_task,
    run_task_now,
)
from app.config.loader import load_runtime_config
from app.connectors.db import create_db_engine, run_healthcheck
from app.gui.tk_app import launch_gui
from app.sync_service import CommandResult, SyncService
from app.utils.logging import configure_logging, get_logger

cli = typer.Typer(add_completion=False, no_args_is_help=True)
automation_task_cli = typer.Typer(add_completion=False, no_args_is_help=True)
cli.add_typer(automation_task_cli, name="automation-task")


def _truncate_message(value: object, max_len: int = 600) -> str:
    text_value = " ".join(str(value).splitlines()).strip()
    if len(text_value) <= max_len:
        return text_value
    return f"{text_value[: max_len - 3]}..."


def _safe_echo(message: str) -> None:
    try:
        typer.echo(message)
    except OSError:
        fallback = message.encode("ascii", errors="ignore").decode("ascii")
        print(fallback)  # noqa: T201


def _echo_sync_result(result: CommandResult) -> None:
    _safe_echo(
        f"run_id={result.run_id} status={result.status} "
        f"message={_truncate_message(result.message)}"
    )
    if result.table_errors:
        joined = ", ".join(sorted(result.table_errors.keys()))
        _safe_echo(f"table_errors={joined}")


def _exit_with_error(exc: Exception) -> None:
    logger = get_logger()
    message = _truncate_message(exc)
    if "advisory lock in use" in str(exc):
        logger.warning("command failed: {}", message)
        _safe_echo(f"INFO: {message}")
        raise typer.Exit(code=2)

    logger.exception("command failed")
    _safe_echo(f"ERROR: {message}")
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


def _build_runner(
    config: str,
    env_file: str,
    automation_config: str | None,
) -> AutomationRunner:
    return AutomationRunner(
        config_path=config,
        env_file=env_file,
        automation_config_path=automation_config,
    )


def _resolve_task_name(
    runner: AutomationRunner,
    provided_task_name: str | None,
) -> str:
    if provided_task_name:
        return provided_task_name
    _, state = runner.load_automation_state()
    return state.task_name


@cli.command("bootstrap")
def bootstrap_command(
    config: str = typer.Option("config.yml", "--config", help="Path to config.yml"),
    env_file: str = typer.Option(".env", "--env-file", help="Path to .env"),
) -> None:
    try:
        service = _build_service(config, env_file)
        result = service.bootstrap()
        _echo_sync_result(result)
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
        _echo_sync_result(result)
    except Exception as exc:
        _exit_with_error(exc)


@cli.command("validate")
def validate_command(
    config: str = typer.Option("config.yml", "--config", help="Path to config.yml"),
    env_file: str = typer.Option(".env", "--env-file", help="Path to .env"),
    table: list[str] | None = typer.Option(None, "--table", help="Restrict execution to table(s)"),
) -> None:
    try:
        service = _build_service(config, env_file)
        result = service.validate_only(table_filter=table)
        _echo_sync_result(result)
    except Exception as exc:
        _exit_with_error(exc)


@cli.command("sync")
def sync_command(
    config: str = typer.Option("config.yml", "--config", help="Path to config.yml"),
    env_file: str = typer.Option(".env", "--env-file", help="Path to .env"),
    table: list[str] | None = typer.Option(None, "--table", help="Restrict execution to table(s)"),
    force_table: list[str] | None = typer.Option(
        None,
        "--force-table",
        help="Ignore source fingerprint for table(s)",
    ),
) -> None:
    try:
        service = _build_service(config, env_file)
        result = service.sync(
            dry_run=False,
            table_filter=table,
            force_tables=force_table,
        )
        _echo_sync_result(result)
    except Exception as exc:
        _exit_with_error(exc)


@cli.command("dry-run")
def dry_run_command(
    config: str = typer.Option("config.yml", "--config", help="Path to config.yml"),
    env_file: str = typer.Option(".env", "--env-file", help="Path to .env"),
    table: list[str] | None = typer.Option(None, "--table", help="Restrict execution to table(s)"),
) -> None:
    try:
        service = _build_service(config, env_file)
        result = service.sync(dry_run=True, table_filter=table)
        _echo_sync_result(result)
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

        if is_edge_transport_enabled():
            ok, message = edge_healthcheck()
            _safe_echo(f"edge_transport=enabled")
            _safe_echo(f"edge_healthcheck={message}")
            if not ok:
                raise typer.Exit(code=1)
            return

        engine = create_db_engine(
            runtime.db,
            connect_timeout_seconds=runtime.supabase.connect_timeout_seconds,
            statement_timeout_seconds=runtime.supabase.statement_timeout_seconds,
        )

        result = run_healthcheck(engine)
        logger = get_logger()
        logger.info("healthcheck_result={} details={}", result.ok, result.details)

        for key, value in result.details.items():
            _safe_echo(f"{key}={value}")

        if not result.ok:
            raise typer.Exit(code=1)
    except typer.Exit:
        raise
    except Exception as exc:
        _exit_with_error(exc)


@cli.command("automation-cycle")
def automation_cycle_command(
    config: str = typer.Option("config.yml", "--config", help="Path to config.yml"),
    env_file: str = typer.Option(".env", "--env-file", help="Path to .env"),
    automation_config: str = typer.Option(
        "automation_config.json",
        "--automation-config",
        help="Path to automation_config.json",
    ),
    scheduled: bool = typer.Option(False, "--scheduled", help="Run with scheduled policy rules"),
    dry_run: bool = typer.Option(False, "--dry-run", help="Validate SQL/read only without promoting"),
    table: list[str] | None = typer.Option(None, "--table", help="Restrict execution to table(s)"),
    reprocess_failures: bool = typer.Option(
        False,
        "--reprocess-failures",
        help="Run only tables pending in failed queue",
    ),
) -> None:
    try:
        runner = _build_runner(config, env_file, automation_config)
        result = runner.run_cycle(
            scheduled=scheduled,
            dry_run=dry_run,
            requested_tables=table,
            reprocess_failures=reprocess_failures,
            triggered_by="automation-cycle",
        )
        summary = result.to_summary()
        _safe_echo(
            "status={status} skipped={skipped} run_id={run_id} message={message}".format(
                status=summary["sync_status"],
                skipped=summary["skipped"],
                run_id=summary["run_id"] or "-",
                message=_truncate_message(summary["sync_message"]),
            )
        )
        if result.failed_tables:
            _safe_echo(f"failed_tables={','.join(result.failed_tables)}")
        if result.skipped and result.skip_reason:
            _safe_echo(f"skip_reason={result.skip_reason}")

        if result.sync_status == "failed" and not result.skipped:
            raise typer.Exit(code=1)
    except typer.Exit:
        raise
    except Exception as exc:
        _exit_with_error(exc)


@automation_task_cli.command("install")
def automation_task_install_command(
    config: str = typer.Option("config.yml", "--config", help="Path to config.yml"),
    env_file: str = typer.Option(".env", "--env-file", help="Path to .env"),
    automation_config: str = typer.Option(
        "automation_config.json",
        "--automation-config",
        help="Path to automation_config.json",
    ),
) -> None:
    try:
        runner = _build_runner(config, env_file, automation_config)
        _, state = runner.load_automation_state()
        result = install_or_update_task(
            config=state,
            config_path=config,
            env_file=env_file,
            automation_config_path=automation_config,
        )
        _safe_echo(f"ok={result.ok} message={_truncate_message(result.message)}")
        if not result.ok:
            raise typer.Exit(code=1)
    except typer.Exit:
        raise
    except Exception as exc:
        _exit_with_error(exc)


@automation_task_cli.command("remove")
def automation_task_remove_command(
    config: str = typer.Option("config.yml", "--config", help="Path to config.yml"),
    env_file: str = typer.Option(".env", "--env-file", help="Path to .env"),
    automation_config: str = typer.Option(
        "automation_config.json",
        "--automation-config",
        help="Path to automation_config.json",
    ),
    task_name: str | None = typer.Option(None, "--task-name", help="Override task name"),
) -> None:
    try:
        runner = _build_runner(config, env_file, automation_config)
        name = _resolve_task_name(runner, task_name)
        result = remove_task(name)
        _safe_echo(f"ok={result.ok} message={_truncate_message(result.message)}")
        if not result.ok:
            raise typer.Exit(code=1)
    except typer.Exit:
        raise
    except Exception as exc:
        _exit_with_error(exc)


@automation_task_cli.command("status")
def automation_task_status_command(
    config: str = typer.Option("config.yml", "--config", help="Path to config.yml"),
    env_file: str = typer.Option(".env", "--env-file", help="Path to .env"),
    automation_config: str = typer.Option(
        "automation_config.json",
        "--automation-config",
        help="Path to automation_config.json",
    ),
    task_name: str | None = typer.Option(None, "--task-name", help="Override task name"),
) -> None:
    try:
        runner = _build_runner(config, env_file, automation_config)
        name = _resolve_task_name(runner, task_name)
        result = query_task_status(name)
        _safe_echo(f"ok={result.ok} message={_truncate_message(result.message, max_len=2000)}")
        if not result.ok:
            raise typer.Exit(code=1)
    except typer.Exit:
        raise
    except Exception as exc:
        _exit_with_error(exc)


@automation_task_cli.command("run-now")
def automation_task_run_now_command(
    config: str = typer.Option("config.yml", "--config", help="Path to config.yml"),
    env_file: str = typer.Option(".env", "--env-file", help="Path to .env"),
    automation_config: str = typer.Option(
        "automation_config.json",
        "--automation-config",
        help="Path to automation_config.json",
    ),
    task_name: str | None = typer.Option(None, "--task-name", help="Override task name"),
) -> None:
    try:
        runner = _build_runner(config, env_file, automation_config)
        name = _resolve_task_name(runner, task_name)
        result = run_task_now(name)
        _safe_echo(f"ok={result.ok} message={_truncate_message(result.message)}")
        if not result.ok:
            raise typer.Exit(code=1)
    except typer.Exit:
        raise
    except Exception as exc:
        _exit_with_error(exc)


@cli.command("gui")
def gui_command(
    config: str = typer.Option("config.yml", "--config", help="Path to config.yml"),
    env_file: str = typer.Option(".env", "--env-file", help="Path to .env"),
    automation_config: str = typer.Option(
        "automation_config.json",
        "--automation-config",
        help="Path to automation_config.json",
    ),
) -> None:
    try:
        launch_gui(
            config=config,
            env_file=env_file,
            automation_config_path=automation_config,
        )
    except Exception as exc:
        _exit_with_error(exc)


def run() -> None:
    cli()
