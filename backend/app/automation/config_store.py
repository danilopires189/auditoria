from __future__ import annotations

import json
from pathlib import Path

from app.automation.models import (
    DEFAULT_AUTOMATION_CONFIG_FILENAME,
    AutomationConfig,
)


def resolve_automation_config_path(
    config_path: str | Path,
    automation_config_path: str | Path | None = None,
) -> Path:
    config_file = Path(config_path).resolve()
    if automation_config_path:
        candidate = Path(automation_config_path)
        return candidate if candidate.is_absolute() else config_file.parent / candidate
    return config_file.parent / DEFAULT_AUTOMATION_CONFIG_FILENAME


def load_automation_config(
    config_path: str | Path,
    automation_config_path: str | Path | None = None,
) -> tuple[Path, AutomationConfig]:
    file_path = resolve_automation_config_path(config_path, automation_config_path)
    if not file_path.exists():
        default_cfg = AutomationConfig()
        save_automation_config(file_path, default_cfg)
        return file_path, default_cfg

    payload = json.loads(file_path.read_text(encoding="utf-8"))
    if not isinstance(payload, dict):
        raise ValueError(f"Invalid automation config payload in: {file_path}")
    return file_path, AutomationConfig.from_dict(payload)


def save_automation_config(file_path: Path, config: AutomationConfig) -> None:
    file_path.parent.mkdir(parents=True, exist_ok=True)
    file_path.write_text(
        json.dumps(config.to_dict(), indent=2, ensure_ascii=True) + "\n",
        encoding="utf-8",
    )
