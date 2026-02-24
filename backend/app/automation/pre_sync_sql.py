from __future__ import annotations

from pathlib import Path

import pandas as pd

from app.automation.models import TableExecutionResult
from app.automation.table_profile import (
    get_table_profile_entry,
    resolve_profile_tables,
)
from app.config.models import RuntimeConfig
from app.etl.extract.readers import read_source_dataframe
from app.refresh.excel_refresh import refresh_excel_file
from app.utils.logging import get_logger


def _convert_excel_to_csv(
    workbook_path: Path,
    sheet_name: str,
    csv_path: Path,
    usecols: list[str] | None,
) -> None:
    frame = pd.read_excel(
        workbook_path,
        sheet_name=sheet_name,
        dtype=object,
        engine="openpyxl",
        usecols=usecols,
    )
    csv_path.parent.mkdir(parents=True, exist_ok=True)
    frame.to_csv(csv_path, index=False, encoding="utf-8")


def run_sql_precheck_for_tables(
    runtime: RuntimeConfig,
    table_names: list[str],
) -> dict[str, TableExecutionResult]:
    logger = get_logger()
    requested_tables = resolve_profile_tables(table_names)
    refresh_cache: dict[str, tuple[bool, str | None]] = {}
    results: dict[str, TableExecutionResult] = {}

    for table_name in requested_tables:
        profile = get_table_profile_entry(table_name)
        table_cfg = runtime.tables.get(table_name)
        if table_cfg is None:
            results[table_name] = TableExecutionResult(
                table_name=table_name,
                source_file=profile.workbook_file,
                query_status="failed",
                sync_status="skipped",
                error=f"Table '{table_name}' is not configured in config.yml",
            )
            continue

        source_workbook = runtime.data_dir_path / profile.workbook_file
        item = TableExecutionResult(
            table_name=table_name,
            source_file=profile.workbook_file,
            query_status="skipped",
            sync_status="pending",
        )

        try:
            cache_key = profile.workbook_file.lower()
            refresh_ok, refresh_error = refresh_cache.get(cache_key, (False, None))
            if cache_key not in refresh_cache:
                refresh_result = refresh_excel_file(
                    source_workbook,
                    timeout_seconds=runtime.app.refresh_timeout_seconds,
                    poll_seconds=runtime.app.refresh_poll_seconds,
                )
                refresh_ok = refresh_result.ok
                refresh_error = refresh_result.error
                refresh_cache[cache_key] = (refresh_ok, refresh_error)

            if not refresh_ok:
                raise RuntimeError(refresh_error or f"Failed to refresh workbook '{profile.workbook_file}'")

            if profile.requires_csv_conversion:
                if not profile.csv_target:
                    raise ValueError(f"CSV target missing for table '{table_name}'")
                csv_target = runtime.data_dir_path / profile.csv_target
                _convert_excel_to_csv(
                    workbook_path=source_workbook,
                    sheet_name=profile.workbook_sheet,
                    csv_path=csv_target,
                    usecols=profile.csv_usecols,
                )

            # Validation of read contract before syncing.
            read_source_dataframe(table_name, table_cfg, runtime.data_dir_path)

            item.query_status = "success"
            item.sync_status = "pending"
            logger.info(
                "automation_precheck table={} query_status=success source_file={}",
                table_name,
                profile.workbook_file,
            )
        except Exception as exc:
            item.query_status = "failed"
            item.sync_status = "skipped"
            item.error = str(exc)
            logger.exception(
                "automation_precheck table={} query_status=failed source_file={}",
                table_name,
                profile.workbook_file,
            )

        results[table_name] = item

    return results
