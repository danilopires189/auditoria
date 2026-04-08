from __future__ import annotations

import sys
import unittest
from pathlib import Path

import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.etl.transform.table_rules import apply_table_specific_rules


class TableRulesTests(unittest.TestCase):
    def test_db_avulso_restores_dt_mov_from_data_mov(self) -> None:
        frame = pd.DataFrame(
            [
                {"cd": 8, "id_mov": "1", "nr_volume": "A", "data_mov": pd.Timestamp("2026-04-07").date()},
                {"cd": 8, "id_mov": "2", "nr_volume": "B", "dt_mov": pd.Timestamp("2026-04-06").date(), "data_mov": pd.Timestamp("2026-04-07").date()},
                {"cd": 8, "id_mov": "3", "nr_volume": "C", "dt_mov": pd.NA, "data_mov": pd.Timestamp("2026-04-08").date()},
            ]
        )

        filtered, stats = apply_table_specific_rules("db_avulso", frame)

        self.assertEqual(stats["populated_dt_mov_from_data_mov"], 2)
        self.assertEqual(filtered["dt_mov"].tolist(), [
            pd.Timestamp("2026-04-07").date(),
            pd.Timestamp("2026-04-06").date(),
            pd.Timestamp("2026-04-08").date(),
        ])

    def test_db_usuario_drops_empty_cd_when_same_mat_has_cd(self) -> None:
        frame = pd.DataFrame(
            [
                {"cd": pd.NA, "mat": "123", "nome": "Maria"},
                {"cd": 7, "mat": "123", "nome": "Maria"},
                {"cd": pd.NA, "mat": "456", "nome": "Jose"},
            ]
        )

        filtered, stats = apply_table_specific_rules("db_usuario", frame)

        self.assertEqual(stats["dropped_empty_cd_duplicate_mat"], 1)
        self.assertEqual(len(filtered), 2)
        self.assertEqual(filtered["mat"].tolist(), ["123", "456"])
        self.assertEqual(filtered["cd"].tolist(), [7, pd.NA])

    def test_db_usuario_keeps_multiple_rows_when_all_have_cd(self) -> None:
        frame = pd.DataFrame(
            [
                {"cd": 3, "mat": "123", "nome": "Maria"},
                {"cd": 7, "mat": "123", "nome": "Maria"},
            ]
        )

        filtered, stats = apply_table_specific_rules("db_usuario", frame)

        self.assertEqual(stats["dropped_empty_cd_duplicate_mat"], 0)
        self.assertEqual(len(filtered), 2)


if __name__ == "__main__":
    unittest.main()
