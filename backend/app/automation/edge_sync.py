from __future__ import annotations

import json
import os
import uuid
from dataclasses import dataclass, field
from typing import Any
from urllib import error as urlerror
from urllib import request as urlrequest

import pandas as pd

from app.config.models import RuntimeConfig, TableConfig
from app.etl.extract.readers import read_source_dataframe
from app.etl.table_specs import get_table_spec
from app.etl.transform.cast import apply_type_casts
from app.etl.transform.normalize import normalize_dataframe, snake_case
from app.etl.transform.table_rules import apply_table_specific_rules
from app.etl.transform.validate import validate_frame
from app.utils.json_safe import to_json_safe
from app.utils.logging import get_logger

EDGE_TRANSPORT_VALUES = {"edge", "edge_function", "http"}
DEFAULT_EDGE_TIMEOUT_SECONDS = 120
DEFAULT_EDGE_CHUNK_SIZE = 1000


@dataclass(frozen=True)
class EdgeSyncSettings:
    url: str
    bearer_token: str
    shared_secret: str
    timeout_seconds: int
    chunk_size: int


@dataclass
class EdgeSyncResult:
    run_id: str
    status: str
    message: str
    table_errors: dict[str, str] = field(default_factory=dict)


def is_edge_transport_enabled() -> bool:
    transport = str(os.getenv("SYNC_TRANSPORT", "")).strip().lower()
    if transport in EDGE_TRANSPORT_VALUES:
        return True
    return bool(str(os.getenv("EDGE_FUNCTION_URL", "")).strip())


def _read_edge_settings() -> EdgeSyncSettings:
    url = str(os.getenv("EDGE_FUNCTION_URL", "")).strip()
    if not url:
        raise ValueError("EDGE_FUNCTION_URL is required when SYNC_TRANSPORT=edge")

    timeout_seconds = _parse_positive_int(
        os.getenv("EDGE_FUNCTION_TIMEOUT_SECONDS"),
        default=DEFAULT_EDGE_TIMEOUT_SECONDS,
    )
    chunk_size = _parse_positive_int(
        os.getenv("EDGE_FUNCTION_CHUNK_SIZE"),
        default=DEFAULT_EDGE_CHUNK_SIZE,
    )
    return EdgeSyncSettings(
        url=url,
        bearer_token=str(os.getenv("EDGE_FUNCTION_BEARER_TOKEN", "")).strip(),
        shared_secret=str(os.getenv("EDGE_FUNCTION_SHARED_SECRET", "")).strip(),
        timeout_seconds=timeout_seconds,
        chunk_size=chunk_size,
    )


def _parse_positive_int(raw_value: str | None, default: int) -> int:
    if raw_value is None or not str(raw_value).strip():
        return default
    value = int(str(raw_value).strip())
    return max(1, value)


def _effective_types(table_name: str, table_cfg: TableConfig) -> dict[str, str]:
    spec = get_table_spec(table_name)
    merged = dict(spec.sql_types)
    merged.update({snake_case(key): value for key, value in table_cfg.types.items()})
    return merged


def _drop_fully_empty_business_rows(
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


def _normalize_list(values: list[str]) -> list[str]:
    return [snake_case(value) for value in values]


def _prepare_rows_for_table(
    runtime: RuntimeConfig,
    table_name: str,
) -> tuple[list[dict[str, Any]], str, list[str], str | None]:
    table_cfg = runtime.tables.get(table_name)
    if table_cfg is None:
        raise ValueError(f"Table '{table_name}' is not configured in config.yml")

    raw = read_source_dataframe(table_name, table_cfg, runtime.data_dir_path)
    normalized, _ = normalize_dataframe(raw)
    cast_result = apply_type_casts(
        normalized,
        table_name,
        _effective_types(table_name, table_cfg),
    )
    prepared_frame, _ = _drop_fully_empty_business_rows(table_name, cast_result.frame)
    prepared_frame, _ = apply_table_specific_rules(table_name, prepared_frame)

    required = _normalize_list(table_cfg.required_columns)
    unique_keys = _normalize_list(table_cfg.unique_keys)
    dedupe_order = _normalize_list(table_cfg.dedupe_order_by)
    validation = validate_frame(
        table_name=table_name,
        frame=prepared_frame,
        required_columns=required,
        unique_keys=unique_keys,
        dedupe_order_by=dedupe_order,
    )

    valid = validation.valid_frame.copy()
    spec = get_table_spec(table_name)
    business_columns = [col for col in spec.business_columns if col in valid.columns]
    if not business_columns:
        raise ValueError(f"[{table_name}] no business columns available in source file")

    valid = valid[business_columns]
    rows = [
        {column: to_json_safe(row[column]) for column in business_columns}
        for _, row in valid.iterrows()
    ]

    sync_mode = table_cfg.mode or runtime.app.default_sync_mode
    replace_filter_column = required[0] if required else (business_columns[0] if business_columns else None)
    return rows, sync_mode, unique_keys, replace_filter_column


def _post_edge_json(settings: EdgeSyncSettings, payload: dict[str, Any]) -> dict[str, Any]:
    body_bytes = json.dumps(payload, ensure_ascii=True).encode("utf-8")
    headers = {
        "Content-Type": "application/json",
        "Accept": "application/json",
    }
    if settings.bearer_token:
        headers["Authorization"] = f"Bearer {settings.bearer_token}"
        headers["apikey"] = settings.bearer_token
    if settings.shared_secret:
        headers["x-ingest-token"] = settings.shared_secret

    request = urlrequest.Request(
        settings.url,
        data=body_bytes,
        headers=headers,
        method="POST",
    )

    try:
        with urlrequest.urlopen(request, timeout=settings.timeout_seconds) as response:
            response_body = response.read().decode("utf-8", errors="replace").strip()
    except urlerror.HTTPError as exc:
        error_body = exc.read().decode("utf-8", errors="replace").strip()
        raise RuntimeError(
            f"edge_http_error status={exc.code} body={error_body or exc.reason}"
        ) from exc
    except Exception as exc:  # noqa: BLE001
        raise RuntimeError(f"edge_request_failed: {exc}") from exc

    if not response_body:
        return {}
    try:
        parsed = json.loads(response_body)
        if isinstance(parsed, dict):
            return parsed
        return {"raw_response": parsed}
    except Exception as exc:  # noqa: BLE001
        raise RuntimeError(f"edge_invalid_json_response: {response_body}") from exc


def edge_healthcheck() -> tuple[bool, str]:
    settings = _read_edge_settings()
    response = _post_edge_json(
        settings,
        {
            "op": "healthcheck",
        },
    )
    ok = bool(response.get("ok", True))
    message = str(response.get("message", "ok"))
    return ok, message


def _chunk_rows(rows: list[dict[str, Any]], chunk_size: int) -> list[list[dict[str, Any]]]:
    if not rows:
        return [[]]
    return [rows[index:index + chunk_size] for index in range(0, len(rows), chunk_size)]


def sync_tables_via_edge(
    runtime: RuntimeConfig,
    table_names: list[str],
    *,
    dry_run: bool,
) -> EdgeSyncResult:
    logger = get_logger()
    settings = _read_edge_settings()
    run_id = f"edge-{uuid.uuid4()}"
    table_errors: dict[str, str] = {}
    synced_tables: list[str] = []

    for table_name in table_names:
        try:
            rows, sync_mode, unique_keys, replace_filter_column = _prepare_rows_for_table(runtime, table_name)
            chunks = _chunk_rows(rows, settings.chunk_size)
            total_chunks = len(chunks)

            for chunk_index, chunk_rows in enumerate(chunks):
                payload = {
                    "op": "sync_table",
                    "run_id": run_id,
                    "table": table_name,
                    "mode": sync_mode,
                    "unique_keys": unique_keys,
                    "replace_filter_column": replace_filter_column,
                    "rows": chunk_rows,
                    "dry_run": dry_run,
                    "batch_index": chunk_index,
                    "batch_total": total_chunks,
                    "reset_table": bool(sync_mode == "full_replace" and chunk_index == 0),
                }
                response = _post_edge_json(settings, payload)
                if response.get("ok") is False:
                    message = str(response.get("error") or response.get("message") or "Edge function returned failure")
                    raise RuntimeError(message)

            synced_tables.append(table_name)
            logger.info(
                "edge_sync table={} mode={} rows={} chunks={} dry_run={}",
                table_name,
                sync_mode,
                len(rows),
                total_chunks,
                dry_run,
            )
        except Exception as exc:  # noqa: BLE001
            table_errors[table_name] = str(exc)
            logger.exception("edge_sync table={} failed", table_name)

    if table_errors and len(table_errors) == len(table_names):
        status = "failed"
    elif table_errors:
        status = "partial"
    else:
        status = "success"

    message = (
        f"edge sync completed tables_ok={len(synced_tables)} tables_failed={len(table_errors)}"
        if status != "failed"
        else "edge sync failed for all selected tables"
    )
    return EdgeSyncResult(
        run_id=run_id,
        status=status,
        message=message,
        table_errors=table_errors,
    )
