from __future__ import annotations

import json
import uuid
from contextlib import contextmanager
from pathlib import Path
from typing import Iterator

import pandas as pd
from sqlalchemy import text
from sqlalchemy.engine import Engine

from app.audit.models import StepCounters
from app.utils.json_safe import to_json_safe
from app.utils.timezone import now_brasilia


class AuditWriter:
    def __init__(self, engine: Engine):
        self.engine = engine

    def start_run(
        self,
        app_version: str,
        machine_id: str,
        config_hash: str,
        notes: str | None = None,
        triggered_by: str | None = None,
    ) -> str:
        run_id = str(uuid.uuid4())
        with self.engine.begin() as conn:
            conn.execute(
                text(
                    """
                    insert into audit.runs (
                        run_id,
                        started_at,
                        status,
                        app_version,
                        machine_id,
                        config_hash,
                        notes,
                        triggered_by
                    )
                    values (
                        :run_id,
                        now(),
                        'running',
                        :app_version,
                        :machine_id,
                        :config_hash,
                        :notes,
                        :triggered_by
                    )
                    """
                ),
                {
                    "run_id": run_id,
                    "app_version": app_version,
                    "machine_id": machine_id,
                    "config_hash": config_hash,
                    "notes": notes,
                    "triggered_by": triggered_by,
                },
            )
        return run_id

    def finish_run(self, run_id: str, status: str, notes: str | None = None) -> None:
        with self.engine.begin() as conn:
            conn.execute(
                text(
                    """
                    update audit.runs
                    set finished_at = now(),
                        status = :status,
                        notes = coalesce(:notes, notes)
                    where run_id = :run_id
                    """
                ),
                {
                    "run_id": run_id,
                    "status": status,
                    "notes": notes,
                },
            )

    def _start_step(self, run_id: str, step_name: str, table_name: str | None) -> int:
        with self.engine.begin() as conn:
            step_id = conn.execute(
                text(
                    """
                    insert into audit.run_steps (
                        run_id,
                        step_name,
                        table_name,
                        started_at,
                        status
                    )
                    values (
                        :run_id,
                        :step_name,
                        :table_name,
                        now(),
                        'running'
                    )
                    returning step_id
                    """
                ),
                {
                    "run_id": run_id,
                    "step_name": step_name,
                    "table_name": table_name,
                },
            ).scalar_one()
        return int(step_id)

    def _finish_step(
        self,
        step_id: int,
        status: str,
        counters: StepCounters,
        error_message: str | None = None,
    ) -> None:
        with self.engine.begin() as conn:
            conn.execute(
                text(
                    """
                    update audit.run_steps
                    set finished_at = now(),
                        status = :status,
                        rows_in = :rows_in,
                        rows_out = :rows_out,
                        rows_rejected = :rows_rejected,
                        error_message = :error_message,
                        details = cast(:details as jsonb)
                    where step_id = :step_id
                    """
                ),
                {
                    "step_id": step_id,
                    "status": status,
                    "rows_in": counters.rows_in,
                    "rows_out": counters.rows_out,
                    "rows_rejected": counters.rows_rejected,
                    "error_message": error_message,
                    "details": json.dumps(to_json_safe(counters.details or {}), ensure_ascii=True),
                },
            )

    @contextmanager
    def step(
        self,
        run_id: str,
        step_name: str,
        table_name: str | None = None,
    ) -> Iterator[StepCounters]:
        step_id = self._start_step(run_id, step_name, table_name)
        counters = StepCounters(details={})
        try:
            yield counters
            self._finish_step(step_id, "success", counters)
        except Exception as exc:
            self._finish_step(step_id, "failed", counters, error_message=str(exc))
            raise

    def write_metadata(self, run_id: str, table_name: str, meta_key: str, meta_value: dict) -> None:
        with self.engine.begin() as conn:
            conn.execute(
                text(
                    """
                    insert into audit.runs_metadata (
                        run_id,
                        table_name,
                        meta_key,
                        meta_value,
                        created_at
                    )
                    values (
                        :run_id,
                        :table_name,
                        :meta_key,
                        cast(:meta_value as jsonb),
                        now()
                    )
                    on conflict (run_id, table_name, meta_key)
                    do update set
                      meta_value = excluded.meta_value,
                      created_at = excluded.created_at
                    """
                ),
                {
                    "run_id": run_id,
                    "table_name": table_name,
                    "meta_key": meta_key,
                    "meta_value": json.dumps(to_json_safe(meta_value), ensure_ascii=True),
                },
            )

    def write_snapshot(self, run_id: str, table_name: str) -> None:
        with self.engine.begin() as conn:
            row = conn.execute(
                text(
                    f"""
                    select
                        count(*)::bigint as row_count,
                        md5(count(*)::text || ':' || coalesce(max(updated_at)::text, '')) as checksum
                    from app."{table_name}"
                    """
                )
            ).first()

            conn.execute(
                text(
                    """
                    insert into audit.table_snapshots (
                        run_id,
                        table_name,
                        row_count,
                        checksum,
                        captured_at
                    )
                    values (
                        :run_id,
                        :table_name,
                        :row_count,
                        :checksum,
                        now()
                    )
                    on conflict (run_id, table_name)
                    do update set
                        row_count = excluded.row_count,
                        checksum = excluded.checksum,
                        captured_at = excluded.captured_at
                    """
                ),
                {
                    "run_id": run_id,
                    "table_name": table_name,
                    "row_count": int(row.row_count if row else 0),
                    "checksum": str(row.checksum if row else ""),
                },
            )

    def write_rejections(
        self,
        run_id: str,
        table_name: str,
        rejections: pd.DataFrame,
        rejections_dir: Path,
    ) -> int:
        if rejections.empty:
            return 0

        normalized = rejections.copy()
        for column in ["source_row_number", "reason_code", "reason_detail", "payload"]:
            if column not in normalized.columns:
                if column == "payload":
                    normalized[column] = [{} for _ in range(len(normalized))]
                else:
                    normalized[column] = None

        normalized["run_id"] = run_id
        normalized["source_row_number"] = normalized["source_row_number"].fillna(0).astype(int)
        normalized["payload"] = normalized["payload"].map(
            lambda value: to_json_safe(value) if isinstance(value, dict) else {"raw": str(value)}
        )

        db_rows = [
            {
                "run_id": row["run_id"],
                "source_row_number": int(row["source_row_number"]),
                "reason_code": row["reason_code"],
                "reason_detail": row["reason_detail"],
                "payload": json.dumps(to_json_safe(row["payload"]), ensure_ascii=True),
            }
            for _, row in normalized.iterrows()
        ]

        with self.engine.begin() as conn:
            conn.execute(
                text(
                    f"""
                    insert into audit."rejections_{table_name}" (
                        run_id,
                        source_row_number,
                        reason_code,
                        reason_detail,
                        payload,
                        created_at
                    )
                    values (
                        :run_id,
                        :source_row_number,
                        :reason_code,
                        :reason_detail,
                        cast(:payload as jsonb),
                        now()
                    )
                    """
                ),
                db_rows,
            )

        rejections_dir.mkdir(parents=True, exist_ok=True)
        timestamp = now_brasilia().strftime("%Y%m%dT%H%M%S%z")
        csv_path = rejections_dir / f"rejections_{table_name}_{run_id}_{timestamp}.csv"
        export = normalized.copy()
        export["payload"] = export["payload"].map(
            lambda value: json.dumps(to_json_safe(value), ensure_ascii=True)
        )
        export.to_csv(csv_path, index=False, encoding="utf-8")

        return len(normalized)
