from __future__ import annotations

import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.automation.runner import (
    reconcile_failed_tables_queue,
    select_cycle_tables,
)


class RunnerHelperTests(unittest.TestCase):
    def test_reconcile_failed_tables_queue(self) -> None:
        queue = ["db_end", "db_log_end"]
        failed = ["db_usuario", "db_log_end"]
        succeeded = ["db_end"]

        result = reconcile_failed_tables_queue(queue, failed, succeeded)

        self.assertEqual(result, ["db_log_end", "db_usuario"])

    def test_select_cycle_tables_reprocess_mode(self) -> None:
        base_tables = ["db_barras", "db_usuario", "db_end"]
        failed_queue = ["db_end", "db_rotas"]

        result = select_cycle_tables(
            base_tables=base_tables,
            failed_queue=failed_queue,
            scheduled=False,
            reprocess_failures=True,
        )

        self.assertEqual(result, ["db_end"])

    def test_select_cycle_tables_scheduled_includes_queue(self) -> None:
        base_tables = ["db_barras", "db_usuario"]
        failed_queue = ["db_end", "db_usuario"]

        result = select_cycle_tables(
            base_tables=base_tables,
            failed_queue=failed_queue,
            scheduled=True,
            reprocess_failures=False,
        )

        self.assertEqual(result, ["db_barras", "db_usuario", "db_end"])


if __name__ == "__main__":
    unittest.main()
