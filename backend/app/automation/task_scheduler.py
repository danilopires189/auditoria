from __future__ import annotations

import os
import subprocess
import sys
from pathlib import Path

from app.automation.models import AutomationConfig, TaskCommandResult


def _is_windows() -> bool:
    return os.name == "nt"


def resolve_runtime_command_prefix() -> list[str]:
    if getattr(sys, "frozen", False):
        return [str(Path(sys.executable).resolve())]

    backend_dir = Path(__file__).resolve().parents[2]
    dist_exe = backend_dir / "dist" / "sync_backend.exe"
    if dist_exe.exists():
        return [str(dist_exe.resolve())]

    return [str(Path(sys.executable).resolve()), str((backend_dir / "main.py").resolve())]


def build_cycle_command(
    config_path: str | Path,
    env_file: str | Path,
    automation_config_path: str | Path | None = None,
) -> str:
    prefix = resolve_runtime_command_prefix()
    args = [
        *prefix,
        "automation-cycle",
        "--scheduled",
        "--config",
        str(Path(config_path).resolve()),
        "--env-file",
        str(Path(env_file).resolve()),
    ]
    if automation_config_path:
        args.extend(["--automation-config", str(Path(automation_config_path).resolve())])
    return subprocess.list2cmdline(args)


def _run_schtasks(args: list[str]) -> TaskCommandResult:
    command = subprocess.list2cmdline(["schtasks", *args])
    if not _is_windows():
        return TaskCommandResult(
            ok=False,
            message="Task Scheduler is only available on Windows",
            command=command,
        )

    proc = subprocess.run(
        ["schtasks", *args],
        capture_output=True,
        text=True,
        check=False,
    )
    stdout = (proc.stdout or "").strip()
    stderr = (proc.stderr or "").strip()
    ok = proc.returncode == 0
    message = stdout if ok else (stderr or stdout or f"schtasks exited with code {proc.returncode}")
    return TaskCommandResult(
        ok=ok,
        message=message,
        command=command,
        stdout=stdout,
        stderr=stderr,
    )


def build_create_task_args(
    config: AutomationConfig,
    run_command: str,
) -> list[str]:
    return [
        "/Create",
        "/TN",
        config.task_name,
        "/TR",
        run_command,
        "/SC",
        "MINUTE",
        "/MO",
        str(max(1, int(config.interval_minutes))),
        "/ST",
        config.window_start,
        "/ET",
        config.window_end,
        "/RL",
        "LIMITED",
        "/IT",
        "/F",
    ]


def install_or_update_task(
    config: AutomationConfig,
    config_path: str | Path,
    env_file: str | Path,
    automation_config_path: str | Path | None = None,
) -> TaskCommandResult:
    run_command = build_cycle_command(
        config_path=config_path,
        env_file=env_file,
        automation_config_path=automation_config_path,
    )
    args = build_create_task_args(config=config, run_command=run_command)
    return _run_schtasks(args)


def remove_task(task_name: str) -> TaskCommandResult:
    return _run_schtasks(
        [
            "/Delete",
            "/TN",
            task_name,
            "/F",
        ]
    )


def query_task_status(task_name: str) -> TaskCommandResult:
    return _run_schtasks(
        [
            "/Query",
            "/TN",
            task_name,
            "/V",
            "/FO",
            "LIST",
        ]
    )


def run_task_now(task_name: str) -> TaskCommandResult:
    return _run_schtasks(
        [
            "/Run",
            "/TN",
            task_name,
        ]
    )
