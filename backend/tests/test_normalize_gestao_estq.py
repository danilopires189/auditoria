from __future__ import annotations

import sys
import unittest
from pathlib import Path

import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.etl.transform.normalize import normalize_dataframe


class NormalizeGestaoEstqTests(unittest.TestCase):
    def test_gestao_estq_aliases_map_to_expected_columns(self) -> None:
        frame = pd.DataFrame(
            [
                {
                    "CD": 2,
                    "Data": "02/04/2026",
                    "CODDV": "12345",
                    "Desc": "Produto teste",
                    "Tipo": "EA",
                    "CATEGORIA N1": "Bebidas",
                    "FORNECEDOR": "Fornecedor XPTO",
                    "Quantidade": "7",
                    "TT_CMPC": "-123.45",
                }
            ]
        )

        normalized, dropped = normalize_dataframe(frame)

        self.assertEqual(dropped, [])
        self.assertEqual(
            normalized.columns.tolist(),
            [
                "cd",
                "data_mov",
                "coddv",
                "descricao",
                "tipo_movimentacao",
                "categoria_n1",
                "fornecedor",
                "quantidade_mov",
                "valor_mov",
            ],
        )
        self.assertEqual(normalized.loc[0, "tipo_movimentacao"], "EA")
        self.assertEqual(normalized.loc[0, "categoria_n1"], "Bebidas")
        self.assertEqual(normalized.loc[0, "fornecedor"], "Fornecedor XPTO")
        self.assertEqual(normalized.loc[0, "quantidade_mov"], "7")
        self.assertEqual(normalized.loc[0, "valor_mov"], "-123.45")


if __name__ == "__main__":
    unittest.main()
