from __future__ import annotations

import sys
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.automation.models import AutomationConfig
from app.automation.task_scheduler import (
    build_create_task_args,
    build_cycle_command,
)


class TaskSchedulerTests(unittest.TestCase):
    def test_build_cycle_command_contains_expected_tokens(self) -> None:
        with patch(
            "app.automation.task_scheduler.resolve_runtime_command_prefix",
            return_value=[r"C:\SYNC\sync_backend.exe"],
        ):
            command = build_cycle_command(
                config_path=r"C:\SYNC\config.yml",
                env_file=r"C:\SYNC\.env",
                automation_config_path=r"C:\SYNC\automation_config.json",
            )

        self.assertIn("automation-cycle", command)
        self.assertIn("--scheduled", command)
        self.assertIn("config.yml", command)
        self.assertIn("automation_config.json", command)

    def test_build_create_task_args_mon_to_sat(self) -> None:
        cfg = AutomationConfig(
            interval_minutes=30,
            window_start="06:00",
            window_end="19:00",
            exclude_sunday=True,
            task_name="AUDITORIA_SYNC_AUTO",
        )

        args = build_create_task_args(cfg, run_command="sync_backend.exe automation-cycle --scheduled")

        self.assertEqual(args[0], "/Create")
        self.assertIn("/TN", args)
        self.assertIn("AUDITORIA_SYNC_AUTO", args)
        self.assertNotIn("/D", args)


if __name__ == "__main__":
    unittest.main()
