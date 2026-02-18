from __future__ import annotations

from contextlib import nullcontext
from dataclasses import dataclass
from pathlib import Path

import pandas as pd
from sqlalchemy.engine import Engine

from app.audit.writer import AuditWriter
from app.config.models import RuntimeConfig, TableConfig
from app.ddl.migrator import apply_migrations
from app.etl.extract.readers import read_source_dataframe
from app.etl.load.staging_loader import clear_staging_for_run, load_dataframe_to_staging
from app.etl.promote.full_replace import promote_full_replace
from app.etl.promote.incremental import promote_incremental
from app.etl.promote.insert_new import promote_insert_new
from app.etl.promote.upsert import promote_upsert
from app.etl.table_specs import get_table_spec
from app.etl.transform.cast import apply_type_casts
from app.etl.transform.normalize import normalize_dataframe, snake_case
from app.etl.transform.validate import validate_frame
from app.refresh.excel_refresh import refresh_excel_file
from app.utils.hashers import sha256_file
from app.utils.machine_id import get_machine_id
from app.utils.logging import get_logger


@dataclass
class CommandResult:
    run_id: str
    status: str
    message: str


class SyncService:
    def __init__(self, engine: Engine, config: RuntimeConfig, app_version: str = "1.0.0"):
        self.engine = engine
        self.config = config
        self.audit = AuditWriter(engine)
        self.app_version = app_version
        self.logger = get_logger()

    @property
    def _config_hash(self) -> str:
        return sha256_file(self.config.config_path)

    @property
    def _machine_id(self) -> str:
        return get_machine_id()

    def bootstrap(self) -> CommandResult:
        sql_dir = Path(__file__).resolve().parent / "ddl" / "sql"
        migration_results = apply_migrations(self.engine, sql_dir)
        applied_count = sum(1 for item in migration_results if item.applied)

        run_id = self.audit.start_run(
            app_version=self.app_version,
            machine_id=self._machine_id,
            config_hash=self._config_hash,
            notes="bootstrap",
            triggered_by="bootstrap",
        )

        try:
            with self.audit.step(run_id, "cleanup", "ddl_migrations") as counters:
                counters.rows_in = len(migration_results)
                counters.rows_out = applied_count
                counters.details = {
                    "applied_versions": [item.version for item in migration_results if item.applied],
                    "skipped_versions": [item.version for item in migration_results if not item.applied],
                }

            self.audit.finish_run(run_id, "success", notes="bootstrap completed")
            return CommandResult(run_id=run_id, status="success", message="bootstrap completed")
        except Exception as exc:
            self.audit.finish_run(run_id, "failed", notes=str(exc))
            raise

    def refresh_only(self) -> CommandResult:
        run_id = self.audit.start_run(
            app_version=self.app_version,
            machine_id=self._machine_id,
            config_hash=self._config_hash,
            notes="refresh",
            triggered_by="refresh",
        )

        failed_tables: list[str] = []

        try:
            for table_name, table_cfg in self.config.tables.items():
                if not table_cfg.refresh_before_load:
                    continue

                source_path = self.config.data_dir_path / table_cfg.file
                with self.audit.step(run_id, "refresh", table_name) as counters:
                    result = refresh_excel_file(
                        source_path,
                        timeout_seconds=self.config.app.refresh_timeout_seconds,
                        poll_seconds=self.config.app.refresh_poll_seconds,
                    )
                    counters.details = {
                        "file": table_cfg.file,
                        "elapsed_seconds": round(result.elapsed_seconds, 3),
                    }
                    if not result.ok:
                        counters.details["error"] = result.error
                        failed_tables.append(table_name)
                        raise RuntimeError(result.error)

            status = "success" if not failed_tables else "partial"
            notes = None if not failed_tables else f"refresh failures: {','.join(failed_tables)}"
            self.audit.finish_run(run_id, status, notes=notes)
            return CommandResult(run_id=run_id, status=status, message="refresh completed")
        except Exception as exc:
            self.audit.finish_run(run_id, "failed", notes=str(exc))
            raise

    def validate_only(self) -> CommandResult:
        return self._run_sync(dry_run=True, validate_only=True)

    def sync(self, dry_run: bool = False) -> CommandResult:
        return self._run_sync(dry_run=dry_run, validate_only=False)

    def _normalize_list(self, values: list[str]) -> list[str]:
        return [snake_case(value) for value in values]

    def _effective_types(self, table_name: str, table_cfg: TableConfig) -> dict[str, str]:
        spec = get_table_spec(table_name)
        merged = dict(spec.sql_types)
        merged.update({snake_case(k): v for k, v in table_cfg.types.items()})
        return merged

    def _drop_fully_empty_business_rows(
        self,
        table_name: str,
        frame: pd.DataFrame,
    ) -> tuple[pd.DataFrame, int]:
        spec = get_table_spec(table_name)
        business_columns = [col for col in spec.business_columns if col in frame.columns]
        if not business_columns:
            return frame, 0

        empty_mask = frame[business_columns].isna().all(axis=1)
        dropped_count = int(empty_mask.sum())
        if dropped_count == 0:
            return frame, 0

        return frame.loc[~empty_mask].copy(), dropped_count

    def _prepare_table_dataset(
        self,
        run_id: str,
        table_name: str,
        table_cfg: TableConfig,
    ) -> tuple[pd.DataFrame, int, int]:
        with self.audit.step(run_id, "validate", table_name) as counters:
            raw = read_source_dataframe(table_name, table_cfg, self.config.data_dir_path)
            normalized, dropped_headers = normalize_dataframe(raw)

            cast_result = apply_type_casts(
                normalized,
                table_name,
                self._effective_types(table_name, table_cfg),
            )
            prepared_frame, dropped_empty_rows = self._drop_fully_empty_business_rows(
                table_name,
                cast_result.frame,
            )

            required = self._normalize_list(table_cfg.required_columns)
            unique_keys = self._normalize_list(table_cfg.unique_keys)
            dedupe_order = self._normalize_list(table_cfg.dedupe_order_by)

            validation = validate_frame(
                table_name=table_name,
                frame=prepared_frame,
                required_columns=required,
                unique_keys=unique_keys,
                dedupe_order_by=dedupe_order,
            )

            rejections = pd.concat(
                [
                    cast_result.rejections,
                    validation.rejections,
                ],
                ignore_index=True,
            )

            rejected_rows = self.audit.write_rejections(
                run_id=run_id,
                table_name=table_name,
                rejections=rejections,
                rejections_dir=self.config.rejections_dir_path,
            )

            valid = validation.valid_frame.copy()
            valid["source_file"] = raw["source_file"]
            valid["source_row_number"] = raw["source_row_number"]

            counters.rows_in = validation.rows_in
            counters.rows_out = validation.rows_out
            counters.rows_rejected = rejected_rows
            counters.details = {
                "dropped_headers": dropped_headers,
                "dropped_empty_rows": dropped_empty_rows,
                "required_columns": required,
                "unique_keys": unique_keys,
            }

            return valid, validation.rows_in, rejected_rows

    def _promote_table(
        self,
        run_id: str,
        table_name: str,
        table_cfg: TableConfig,
    ) -> int:
        spec = get_table_spec(table_name)
        mode = table_cfg.mode or self.config.app.default_sync_mode
        unique_keys = self._normalize_list(table_cfg.unique_keys)

        if mode == "full_replace":
            rows_out = promote_full_replace(
                self.engine,
                table_name=table_name,
                business_columns=spec.business_columns,
                run_id=run_id,
            )
            return rows_out

        if mode == "upsert":
            return promote_upsert(
                self.engine,
                table_name=table_name,
                business_columns=spec.business_columns,
                unique_keys=unique_keys,
                run_id=run_id,
            )

        if mode == "incremental":
            if not table_cfg.incremental:
                raise ValueError(f"[{table_name}] incremental config is required")

            promoted_rows, cutoff_value, incoming_max = promote_incremental(
                self.engine,
                table_name=table_name,
                business_columns=spec.business_columns,
                unique_keys=unique_keys,
                run_id=run_id,
                watermark_column=snake_case(table_cfg.incremental.watermark_column),
                lookback_days=table_cfg.incremental.lookback_days,
            )

            self.audit.write_metadata(
                run_id,
                table_name,
                "incremental_watermark",
                {
                    "watermark_column": snake_case(table_cfg.incremental.watermark_column),
                    "lookback_days": table_cfg.incremental.lookback_days,
                    "cutoff": cutoff_value,
                    "incoming_max": incoming_max,
                },
            )
            return promoted_rows

        if mode == "insert_new":
            return promote_insert_new(
                self.engine,
                table_name=table_name,
                business_columns=spec.business_columns,
                run_id=run_id,
            )

        raise ValueError(f"[{table_name}] unsupported sync mode: {mode}")

    def _run_sync(self, dry_run: bool, validate_only: bool) -> CommandResult:
        run_kind = "validate" if validate_only else ("dry-run" if dry_run else "sync")

        run_id = self.audit.start_run(
            app_version=self.app_version,
            machine_id=self._machine_id,
            config_hash=self._config_hash,
            notes=run_kind,
            triggered_by=run_kind,
        )

        status = "success"
        errors: list[str] = []

        from app.connectors.db import advisory_lock

        try:
            lock_context = advisory_lock(self.engine) if not validate_only else nullcontext()
            with lock_context:
                for table_name, table_cfg in self.config.tables.items():
                    try:
                        if table_cfg.refresh_before_load:
                            source_path = self.config.data_dir_path / table_cfg.file
                            with self.audit.step(run_id, "refresh", table_name) as counters:
                                refresh_result = refresh_excel_file(
                                    source_path,
                                    timeout_seconds=self.config.app.refresh_timeout_seconds,
                                    poll_seconds=self.config.app.refresh_poll_seconds,
                                )
                                counters.details = {
                                    "file": table_cfg.file,
                                    "elapsed_seconds": round(refresh_result.elapsed_seconds, 3),
                                }
                                if not refresh_result.ok:
                                    counters.details["error"] = refresh_result.error
                                    raise RuntimeError(refresh_result.error)

                        valid_frame, rows_in, rejected_rows = self._prepare_table_dataset(
                            run_id,
                            table_name,
                            table_cfg,
                        )

                        rows_loaded = 0
                        if not (dry_run or validate_only):
                            with self.audit.step(run_id, "load_staging", table_name) as counters:
                                rows_loaded = load_dataframe_to_staging(
                                    self.engine,
                                    table_name,
                                    valid_frame,
                                    run_id,
                                )
                                counters.rows_in = len(valid_frame)
                                counters.rows_out = rows_loaded
                                counters.rows_rejected = rejected_rows

                            with self.audit.step(run_id, "promote", table_name) as counters:
                                rows_promoted = self._promote_table(run_id, table_name, table_cfg)
                                self.audit.write_snapshot(run_id, table_name)
                                counters.rows_in = rows_loaded
                                counters.rows_out = rows_promoted
                                counters.rows_rejected = rejected_rows

                            with self.audit.step(run_id, "cleanup", table_name) as counters:
                                clear_staging_for_run(self.engine, table_name, run_id)
                                counters.rows_in = rows_loaded
                                counters.rows_out = 0

                        self.logger.info(
                            "table={} rows_in={} rows_valid={} rows_rejected={}",
                            table_name,
                            rows_in,
                            len(valid_frame),
                            rejected_rows,
                        )

                    except Exception as table_exc:
                        errors.append(f"{table_name}: {table_exc}")
                        self.logger.exception("table sync failed: {}", table_name)
                        if self.config.app.stop_on_error:
                            raise
                        status = "partial"
                        continue

            if errors and status == "success":
                status = "partial"

            notes = "; ".join(errors) if errors else f"{run_kind} completed"
            self.audit.finish_run(run_id, status, notes=notes)
            return CommandResult(run_id=run_id, status=status, message=notes)

        except Exception as exc:
            self.audit.finish_run(run_id, "failed", notes=str(exc))
            raise
