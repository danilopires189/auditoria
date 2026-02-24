from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime
from typing import Literal

DEFAULT_AUTOMATION_CONFIG_FILENAME = "automation_config.json"
DEFAULT_TASK_NAME = "AUDITORIA_SYNC_AUTO"
DEFAULT_INTERVAL_MINUTES = 30
DEFAULT_WINDOW_START = "06:00"
DEFAULT_WINDOW_END = "19:00"
DEFAULT_TIMEZONE = "America/Sao_Paulo"

TableQueryStatus = Literal["success", "failed", "skipped"]
TableSyncStatus = Literal["pending", "success", "failed", "skipped"]


@dataclass
class AutomationConfig:
    automation_enabled: bool = False
    interval_minutes: int = DEFAULT_INTERVAL_MINUTES
    window_start: str = DEFAULT_WINDOW_START
    window_end: str = DEFAULT_WINDOW_END
    timezone: str = DEFAULT_TIMEZONE
    exclude_sunday: bool = True
    task_name: str = DEFAULT_TASK_NAME
    last_full_run_date: str | None = None
    failed_tables_queue: list[str] = field(default_factory=list)

    @classmethod
    def from_dict(cls, payload: dict[str, object]) -> "AutomationConfig":
        return cls(
            automation_enabled=bool(payload.get("automation_enabled", False)),
            interval_minutes=max(1, int(payload.get("interval_minutes", DEFAULT_INTERVAL_MINUTES))),
            window_start=str(payload.get("window_start", DEFAULT_WINDOW_START)),
            window_end=str(payload.get("window_end", DEFAULT_WINDOW_END)),
            timezone=str(payload.get("timezone", DEFAULT_TIMEZONE)),
            exclude_sunday=bool(payload.get("exclude_sunday", True)),
            task_name=str(payload.get("task_name", DEFAULT_TASK_NAME)),
            last_full_run_date=(
                str(payload.get("last_full_run_date"))
                if payload.get("last_full_run_date") is not None
                else None
            ),
            failed_tables_queue=[
                str(item)
                for item in payload.get("failed_tables_queue", [])
                if str(item).strip()
            ],
        )

    def to_dict(self) -> dict[str, object]:
        return {
            "automation_enabled": self.automation_enabled,
            "interval_minutes": int(self.interval_minutes),
            "window_start": self.window_start,
            "window_end": self.window_end,
            "timezone": self.timezone,
            "exclude_sunday": self.exclude_sunday,
            "task_name": self.task_name,
            "last_full_run_date": self.last_full_run_date,
            "failed_tables_queue": list(self.failed_tables_queue),
        }


@dataclass
class TableExecutionResult:
    table_name: str
    source_file: str | None = None
    query_status: TableQueryStatus = "skipped"
    sync_status: TableSyncStatus = "pending"
    error: str | None = None


@dataclass
class AutomationCycleResult:
    started_at: datetime
    triggered_by: str
    scheduled: bool
    requested_tables: list[str]
    dry_run: bool
    finished_at: datetime | None = None
    skipped: bool = False
    skip_reason: str | None = None
    run_id: str | None = None
    sync_status: str = "skipped"
    sync_message: str = ""
    table_results: dict[str, TableExecutionResult] = field(default_factory=dict)
    synced_tables: list[str] = field(default_factory=list)
    failed_tables: list[str] = field(default_factory=list)
    next_run_at: datetime | None = None

    def finalize(self) -> None:
        if self.finished_at is None:
            self.finished_at = datetime.now(tz=self.started_at.tzinfo)

    def to_summary(self) -> dict[str, object]:
        return {
            "run_id": self.run_id,
            "sync_status": self.sync_status,
            "sync_message": self.sync_message,
            "scheduled": self.scheduled,
            "skipped": self.skipped,
            "skip_reason": self.skip_reason,
            "requested_tables": list(self.requested_tables),
            "synced_tables": list(self.synced_tables),
            "failed_tables": list(self.failed_tables),
            "started_at": self.started_at.isoformat(),
            "finished_at": self.finished_at.isoformat() if self.finished_at else None,
            "next_run_at": self.next_run_at.isoformat() if self.next_run_at else None,
        }


@dataclass
class TaskCommandResult:
    ok: bool
    message: str
    command: str
    stdout: str = ""
    stderr: str = ""
