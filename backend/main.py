from __future__ import annotations

import os
import sys
from pathlib import Path

from app.cli.app import run as run_cli
from app.gui.tk_app import launch_gui


if __name__ == "__main__":
    runtime_dir = (
        Path(sys.executable).resolve().parent
        if getattr(sys, "frozen", False)
        else Path(__file__).resolve().parent
    )
    os.chdir(runtime_dir)

    if len(sys.argv) == 1:
        launch_gui(config="config.yml", env_file=".env", automation_config_path="automation_config.json")
    else:
        run_cli()
