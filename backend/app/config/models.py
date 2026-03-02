from __future__ import annotations

from pathlib import Path
from typing import Literal

from pydantic import BaseModel, Field, field_validator, model_validator


SyncMode = Literal["full_replace", "upsert", "incremental", "insert_new"]


class IncrementalConfig(BaseModel):
    watermark_column: str
    lookback_days: int = 7

    @field_validator("lookback_days")
    @classmethod
    def validate_lookback_days(cls, value: int) -> int:
        if value < 0:
            raise ValueError("lookback_days must be >= 0")
        return value


class TableConfig(BaseModel):
    file: str
    sheet: str | None = None
    mode: SyncMode | None = None
    unique_keys: list[str] = Field(default_factory=list)
    required_columns: list[str] = Field(default_factory=list)
    refresh_before_load: bool = False
    incremental: IncrementalConfig | None = None
    types: dict[str, str] = Field(default_factory=dict)
    dedupe_order_by: list[str] = Field(default_factory=list)

    @model_validator(mode="after")
    def validate_incremental_contract(self) -> "TableConfig":
        if self.mode == "incremental" and self.incremental is None:
            raise ValueError("incremental mode requires incremental configuration")
        return self


class AppConfig(BaseModel):
    data_dir: str = "./DATA"
    stop_on_error: bool = False
    default_sync_mode: SyncMode = "full_replace"
    rejections_dir: str = "./logs/rejections"
    rejections_retention_days: int = 14
    refresh_timeout_seconds: int = 300
    refresh_poll_seconds: int = 2
    log_level: str = "INFO"

    @field_validator("rejections_retention_days")
    @classmethod
    def validate_rejections_retention_days(cls, value: int) -> int:
        if value < 0:
            raise ValueError("rejections_retention_days must be >= 0")
        return value


class SupabaseConfig(BaseModel):
    connect_timeout_seconds: int = 15
    statement_timeout_seconds: int = 300
    pool_size: int = 5
    max_overflow: int = 5
    pool_timeout_seconds: int = 30
    pool_recycle_seconds: int = 1800

    @field_validator(
        "connect_timeout_seconds",
        "statement_timeout_seconds",
        "pool_size",
        "pool_timeout_seconds",
        "pool_recycle_seconds",
    )
    @classmethod
    def validate_positive_values(cls, value: int) -> int:
        if value <= 0:
            raise ValueError("supabase numeric values must be > 0")
        return value

    @field_validator("max_overflow")
    @classmethod
    def validate_max_overflow(cls, value: int) -> int:
        if value < 0:
            raise ValueError("max_overflow must be >= 0")
        return value


class ConfigModel(BaseModel):
    app: AppConfig
    supabase: SupabaseConfig
    tables: dict[str, TableConfig]


class DbCredentials(BaseModel):
    host: str
    port: int
    dbname: str
    user: str
    password: str


class RuntimeConfig(BaseModel):
    config_path: Path
    env_path: Path
    app: AppConfig
    supabase: SupabaseConfig
    tables: dict[str, TableConfig]
    db: DbCredentials

    @property
    def data_dir_path(self) -> Path:
        path = Path(self.app.data_dir)
        return path if path.is_absolute() else self.config_path.parent / path

    @property
    def rejections_dir_path(self) -> Path:
        path = Path(self.app.rejections_dir)
        return path if path.is_absolute() else self.config_path.parent / path
