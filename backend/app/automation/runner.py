from __future__ import annotations

import json
from datetime import datetime
from pathlib import Path

from sqlalchemy import text

from app.automation.config_store import (
    load_automation_config,
    save_automation_config,
)
from app.automation.edge_sync import (
    is_edge_transport_enabled,
    sync_tables_via_edge,
)
from app.automation.models import (
    AutomationConfig,
    AutomationCycleResult,
)
from app.automation.pre_sync_sql import run_sql_precheck_for_tables
from app.automation.table_profile import profile_table_names, resolve_profile_tables
from app.automation.window_policy import (
    evaluate_scheduled_window,
    is_first_full_run_of_day,
    next_scheduled_run_at,
    now_in_timezone,
)
from app.config.loader import load_runtime_config
from app.config.models import RuntimeConfig
from app.connectors.db import create_db_engine
from app.sync_service import SyncService
from app.utils.logging import configure_logging, get_logger


def _short_error_message(value: object, max_len: int = 300) -> str:
    text_value = " ".join(str(value).splitlines()).strip()
    if len(text_value) <= max_len:
        return text_value
    return f"{text_value[: max_len - 3]}..."


def _unique_ordered(values: list[str]) -> list[str]:
    seen: set[str] = set()
    output: list[str] = []
    for value in values:
        if value not in seen:
            output.append(value)
            seen.add(value)
    return output


def reconcile_failed_tables_queue(
    existing_queue: list[str],
    failed_tables: list[str],
    succeeded_tables: list[str],
) -> list[str]:
    queue = _unique_ordered([item for item in existing_queue if item.strip()])
    succeeded_set = set(succeeded_tables)
    failed_set = set(failed_tables)

    queue = [item for item in queue if item not in succeeded_set]
    for table_name in failed_tables:
        if table_name not in queue and table_name in failed_set:
            queue.append(table_name)
    return queue


def select_cycle_tables(
    base_tables: list[str],
    failed_queue: list[str],
    *,
    scheduled: bool,
    reprocess_failures: bool,
) -> list[str]:
    if reprocess_failures:
        return _unique_ordered([item for item in failed_queue if item in set(base_tables)])

    selected = list(base_tables)
    if scheduled:
        for failed_table in failed_queue:
            if failed_table not in selected:
                selected.append(failed_table)
    return _unique_ordered(selected)


class AutomationRunner:
    def __init__(
        self,
        config_path: str | Path,
        env_file: str | Path,
        automation_config_path: str | Path | None = None,
    ):
        self.config_path = str(config_path)
        self.env_file = str(env_file)
        self.automation_config_path = str(automation_config_path) if automation_config_path else None

    def _load_runtime(self) -> RuntimeConfig:
        runtime = load_runtime_config(self.config_path, self.env_file)
        configure_logging(runtime.app.log_level, runtime.config_path.parent / "logs")
        return runtime

    def _build_service(self, runtime: RuntimeConfig) -> SyncService:
        engine = create_db_engine(
            runtime.db,
            connect_timeout_seconds=runtime.supabase.connect_timeout_seconds,
            statement_timeout_seconds=runtime.supabase.statement_timeout_seconds,
        )
        return SyncService(engine=engine, config=runtime)

    def load_automation_state(self) -> tuple[Path, AutomationConfig]:
        runtime = self._load_runtime()
        return load_automation_config(runtime.config_path, self.automation_config_path)

    def save_automation_state(self, config: AutomationConfig) -> Path:
        runtime = self._load_runtime()
        config_path, _ = load_automation_config(runtime.config_path, self.automation_config_path)
        save_automation_config(config_path, config)
        return config_path

    def fetch_last_run_summary(self) -> dict[str, object] | None:
        if is_edge_transport_enabled():
            return None

        runtime = self._load_runtime()
        service = self._build_service(runtime)
        with service.engine.begin() as conn:
            row = conn.execute(
                text(
                    """
                    select
                        run_id,
                        status,
                        started_at,
                        finished_at,
                        triggered_by,
                        notes
                    from audit.runs
                    order by started_at desc
                    limit 1
                    """
                )
            ).mappings().first()
        if not row:
            return None

        return {
            "run_id": str(row["run_id"]),
            "status": str(row["status"]),
            "started_at": str(row["started_at"]),
            "finished_at": str(row["finished_at"]) if row["finished_at"] is not None else None,
            "triggered_by": str(row["triggered_by"]) if row["triggered_by"] else "",
            "notes": str(row["notes"]) if row["notes"] else "",
        }

    def run_cycle(
        self,
        *,
        scheduled: bool,
        dry_run: bool = False,
        requested_tables: list[str] | None = None,
        reprocess_failures: bool = False,
        triggered_by: str | None = None,
    ) -> AutomationCycleResult:
        runtime = self._load_runtime()
        logger = get_logger()
        automation_path, automation_cfg = load_automation_config(
            runtime.config_path,
            self.automation_config_path,
        )

        now = now_in_timezone(automation_cfg.timezone)
        all_profile_tables = profile_table_names()
        requested_profile_tables = resolve_profile_tables(requested_tables)

        first_full_run_today = scheduled and is_first_full_run_of_day(
            now,
            automation_cfg.last_full_run_date,
        )
        base_tables = all_profile_tables if first_full_run_today else requested_profile_tables
        selected_tables = select_cycle_tables(
            base_tables=base_tables,
            failed_queue=automation_cfg.failed_tables_queue,
            scheduled=scheduled,
            reprocess_failures=reprocess_failures,
        )

        result = AutomationCycleResult(
            started_at=now,
            triggered_by=triggered_by or ("automation-scheduled" if scheduled else "automation-manual"),
            scheduled=scheduled,
            requested_tables=selected_tables,
            dry_run=dry_run,
        )

        if scheduled and not automation_cfg.automation_enabled:
            result.skipped = True
            result.skip_reason = "automation_disabled"
            result.sync_status = "skipped"
            result.sync_message = "Automation disabled in local settings"
            result.next_run_at = next_scheduled_run_at(now, automation_cfg)
            result.finalize()
            return result

        if scheduled:
            allowed, reason = evaluate_scheduled_window(now, automation_cfg)
            if not allowed:
                result.skipped = True
                result.skip_reason = reason
                result.sync_status = "skipped"
                result.sync_message = f"Scheduled run skipped: {reason}"
                result.next_run_at = next_scheduled_run_at(now, automation_cfg)
                result.finalize()
                return result

        if not selected_tables:
            result.skipped = True
            result.skip_reason = "no_tables_selected"
            result.sync_status = "skipped"
            result.sync_message = "No tables selected for this cycle"
            result.next_run_at = next_scheduled_run_at(now, automation_cfg)
            result.finalize()
            return result

        precheck_results = run_sql_precheck_for_tables(runtime, selected_tables)
        result.table_results = precheck_results
        precheck_failed_tables = [
            table_name
            for table_name, table_result in precheck_results.items()
            if table_result.query_status == "failed"
        ]

        tables_to_sync = [
            table_name
            for table_name, table_result in precheck_results.items()
            if table_result.query_status == "success"
        ]
        force_tables = all_profile_tables if first_full_run_today else []

        sync_failed_tables: list[str] = []
        sync_success_tables: list[str] = []

        if tables_to_sync:
            if is_edge_transport_enabled():
                sync_result = sync_tables_via_edge(
                    runtime=runtime,
                    table_names=tables_to_sync,
                    dry_run=dry_run,
                )
            else:
                service = self._build_service(runtime)
                sync_result = service.sync(
                    dry_run=dry_run,
                    table_filter=tables_to_sync,
                    force_tables=force_tables,
                )
            result.run_id = sync_result.run_id
            result.sync_status = sync_result.status
            result.sync_message = sync_result.message

            if sync_result.status == "failed" and not sync_result.table_errors:
                failure_message = _short_error_message(sync_result.message)
                for table_name in tables_to_sync:
                    result.table_results[table_name].sync_status = "failed"
                    result.table_results[table_name].error = failure_message
                    sync_failed_tables.append(table_name)
            else:
                for table_name in tables_to_sync:
                    table_error = sync_result.table_errors.get(table_name)
                    if table_error:
                        result.table_results[table_name].sync_status = "failed"
                        result.table_results[table_name].error = _short_error_message(table_error)
                        sync_failed_tables.append(table_name)
                    else:
                        result.table_results[table_name].sync_status = "success"
                        sync_success_tables.append(table_name)
        else:
            result.sync_status = "partial" if precheck_failed_tables else "success"
            result.sync_message = (
                "No table eligible for sync after SQL pre-check"
                if precheck_failed_tables
                else "No table to sync"
            )

        result.synced_tables = sync_success_tables
        result.failed_tables = _unique_ordered(precheck_failed_tables + sync_failed_tables)

        automation_cfg.failed_tables_queue = reconcile_failed_tables_queue(
            existing_queue=automation_cfg.failed_tables_queue,
            failed_tables=result.failed_tables,
            succeeded_tables=sync_success_tables,
        )
        if scheduled and first_full_run_today:
            automation_cfg.last_full_run_date = now.date().isoformat()

        save_automation_config(automation_path, automation_cfg)
        result.next_run_at = next_scheduled_run_at(now, automation_cfg)
        result.finalize()

        for table_name, table_result in result.table_results.items():
            payload = {
                "timestamp": datetime.now(tz=now.tzinfo).isoformat(),
                "table": table_name,
                "query_status": table_result.query_status,
                "sync_status": table_result.sync_status,
                "error": table_result.error or "",
            }
            logger.info("automation_table_log={}", json.dumps(payload, ensure_ascii=True))

        return result
