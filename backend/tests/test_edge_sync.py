from __future__ import annotations

import os
import sys
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.automation.edge_sync import _chunk_rows, is_edge_transport_enabled


class EdgeSyncTests(unittest.TestCase):
    def test_transport_detection_by_sync_transport(self) -> None:
        with patch.dict(os.environ, {"SYNC_TRANSPORT": "edge"}, clear=False):
            self.assertTrue(is_edge_transport_enabled())

        with patch.dict(os.environ, {"SYNC_TRANSPORT": "postgres", "EDGE_FUNCTION_URL": ""}, clear=False):
            self.assertFalse(is_edge_transport_enabled())

    def test_transport_detection_by_edge_url(self) -> None:
        with patch.dict(os.environ, {"SYNC_TRANSPORT": "", "EDGE_FUNCTION_URL": "https://example.test/fn"}, clear=False):
            self.assertTrue(is_edge_transport_enabled())

    def test_chunk_rows(self) -> None:
        rows = [{"id": i} for i in range(5)]
        chunks = _chunk_rows(rows, 2)
        self.assertEqual(len(chunks), 3)
        self.assertEqual(chunks[0], [{"id": 0}, {"id": 1}])
        self.assertEqual(chunks[2], [{"id": 4}])


if __name__ == "__main__":
    unittest.main()
