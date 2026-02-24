from __future__ import annotations

import sys
import unittest
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.automation.models import AutomationConfig
from app.automation.window_policy import (
    evaluate_scheduled_window,
    is_first_full_run_of_day,
    next_scheduled_run_at,
)


class WindowPolicyTests(unittest.TestCase):
    def test_window_blocks_sunday(self) -> None:
        cfg = AutomationConfig()
        dt = datetime(2026, 2, 22, 10, 0, tzinfo=ZoneInfo("America/Sao_Paulo"))  # Sunday

        allowed, reason = evaluate_scheduled_window(dt, cfg)

        self.assertFalse(allowed)
        self.assertEqual(reason, "sunday_blocked")

    def test_window_blocks_time_outside_range(self) -> None:
        cfg = AutomationConfig(window_start="06:00", window_end="19:00")
        dt = datetime(2026, 2, 23, 5, 30, tzinfo=ZoneInfo("America/Sao_Paulo"))  # Monday

        allowed, reason = evaluate_scheduled_window(dt, cfg)

        self.assertFalse(allowed)
        self.assertEqual(reason, "outside_window")

    def test_next_scheduled_run_respects_next_business_day_window_start(self) -> None:
        cfg = AutomationConfig(
            interval_minutes=30,
            window_start="06:00",
            window_end="19:00",
            exclude_sunday=True,
        )
        dt = datetime(2026, 2, 21, 19, 10, tzinfo=ZoneInfo("America/Sao_Paulo"))  # Saturday

        next_run = next_scheduled_run_at(dt, cfg)

        self.assertEqual(next_run.weekday(), 0)  # Monday
        self.assertEqual(next_run.hour, 6)
        self.assertEqual(next_run.minute, 0)

    def test_first_full_run_detection(self) -> None:
        dt = datetime(2026, 2, 24, 9, 0, tzinfo=ZoneInfo("America/Sao_Paulo"))

        self.assertTrue(is_first_full_run_of_day(dt, last_full_run_date=None))
        self.assertTrue(is_first_full_run_of_day(dt, last_full_run_date="2026-02-23"))
        self.assertFalse(is_first_full_run_of_day(dt, last_full_run_date="2026-02-24"))


if __name__ == "__main__":
    unittest.main()
