from __future__ import annotations

from pathlib import Path
from typing import Any

import yaml
from dotenv import load_dotenv

from app.config.models import ConfigModel, DbCredentials, RuntimeConfig

REQUIRED_ENV_KEYS = (
    "SUPABASE_DB_HOST",
    "SUPABASE_DB_PORT",
    "SUPABASE_DB_NAME",
    "SUPABASE_DB_USER",
    "SUPABASE_DB_PASSWORD",
)


def _read_yaml(path: Path) -> dict[str, Any]:
    if not path.exists():
        raise FileNotFoundError(f"Config file not found: {path}")
    payload = yaml.safe_load(path.read_text(encoding="utf-8"))
    if not isinstance(payload, dict):
        raise ValueError("config.yml must be a mapping at the root")
    return payload


def _read_db_credentials() -> DbCredentials:
    import os

    missing = [key for key in REQUIRED_ENV_KEYS if not os.getenv(key)]
    if missing:
        joined = ", ".join(missing)
        raise ValueError(f"Missing required env vars in .env: {joined}")

    return DbCredentials(
        host=os.environ["SUPABASE_DB_HOST"],
        port=int(os.environ["SUPABASE_DB_PORT"]),
        dbname=os.environ["SUPABASE_DB_NAME"],
        user=os.environ["SUPABASE_DB_USER"],
        password=os.environ["SUPABASE_DB_PASSWORD"],
    )


def load_runtime_config(config_path: str | Path, env_path: str | Path = ".env") -> RuntimeConfig:
    config_file = Path(config_path).resolve()
    dotenv_file = Path(env_path).resolve()

    if dotenv_file.name != ".env":
        raise ValueError("Credentials must be loaded from a .env file")

    if not dotenv_file.exists():
        raise FileNotFoundError(f".env file not found: {dotenv_file}")

    load_dotenv(dotenv_path=dotenv_file, override=False)

    raw_cfg = _read_yaml(config_file)
    model = ConfigModel.model_validate(raw_cfg)

    for table_name, table_cfg in model.tables.items():
        if table_cfg.mode is None:
            table_cfg.mode = model.app.default_sync_mode
        if table_cfg.mode == "incremental" and table_cfg.incremental is None:
            raise ValueError(
                f"Table '{table_name}' is incremental but incremental config is missing"
            )

    db = _read_db_credentials()

    return RuntimeConfig(
        config_path=config_file,
        env_path=dotenv_file,
        app=model.app,
        supabase=model.supabase,
        tables=model.tables,
        db=db,
    )
