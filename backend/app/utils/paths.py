from __future__ import annotations

import sys
from pathlib import Path


def runtime_root() -> Path:
    if getattr(sys, "frozen", False):
        return Path(sys.executable).resolve().parent
    return Path.cwd().resolve()


def resolve_from_root(path_value: str | Path) -> Path:
    path = Path(path_value)
    if path.is_absolute():
        return path
    return runtime_root() / path


def resolve_from_config_dir(path_value: str | Path, config_path: Path) -> Path:
    path = Path(path_value)
    if path.is_absolute():
        return path
    return config_path.resolve().parent / path