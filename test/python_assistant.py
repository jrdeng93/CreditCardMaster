from __future__ import annotations

import os
import sqlite3
import sys
import tempfile
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))

from ccm_py.ask_ccm import ask_ccm
from ccm_py.db import migrate, open_db
from ccm_py.search import search_offers


class EnvGuard:
    def __init__(self, **values):
        self.values = values
        self.previous = {}

    def __enter__(self):
        for key, value in self.values.items():
            self.previous[key] = os.environ.get(key)
            if value is None:
                os.environ.pop(key, None)
            else:
                os.environ[key] = value

    def __exit__(self, *args):
        for key, value in self.previous.items():
            if value is None:
                os.environ.pop(key, None)
            else:
                os.environ[key] = value


class PythonAssistantTest(unittest.TestCase):
    def make_db(self) -> sqlite3.Connection:
        tmpdir = tempfile.TemporaryDirectory()
        self.addCleanup(tmpdir.cleanup)
        conn = open_db(Path(tmpdir.name) / "offers.sqlite")
        migrate(conn)
        return conn

    def insert_offer(self, conn: sqlite3.Connection, issuer: str = "chase") -> None:
        conn.execute(
            """
            INSERT INTO offers (
              issuer, card_name, card_last4, merchant, category, reward_type,
              reward_value, reward_text, min_spend, max_reward, expires_on,
              activation_required, activated, source_text, source_url, raw_hash,
              canonical_merchant, canonical_category, category_confidence,
              first_seen_at, last_seen_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                issuer,
                "Chase Freedom Unlimited" if issuer == "chase" else "Amex Gold",
                "1234",
                "Visible by Verizon",
                "general_shopping",
                "percent",
                25,
                "25% cash back",
                None,
                None,
                "2099-12-31",
                1,
                0,
                "manual test",
                None,
                f"{issuer}-visible",
                "Visible by Verizon",
                "general_shopping",
                1,
                "2026-01-01T00:00:00Z",
                "2026-01-01T00:00:00Z",
            ),
        )
        conn.commit()

    def test_python_assistant_selects_merchant_offer_and_portal(self):
        conn = self.make_db()
        self.insert_offer(conn, "chase")
        with EnvGuard(CCM_DISTRIBUTION="private", CCM_RAG_ENABLED="0"):
            output = ask_ccm(conn, "visible")["output"]
        self.assertIn("Visible by Verizon", output)
        self.assertIn("25% cash back", output)
        self.assertIn("https://www.rakuten.com/shop/visible", output)

    def test_python_public_distribution_hides_non_public_issuers(self):
        conn = self.make_db()
        self.insert_offer(conn, "chase")
        with EnvGuard(CCM_DISTRIBUTION="public", CCM_RAG_ENABLED="0"):
            rows = search_offers(conn, "visible")
        self.assertEqual(rows, [])

    def test_python_assistant_uses_query_language(self):
        conn = self.make_db()
        with EnvGuard(CCM_DISTRIBUTION="public", CCM_RAG_ENABLED="0"):
            output = ask_ccm(conn, "今晚吃饭用什么卡")["output"]
        self.assertIn("使用", output)
        self.assertIn("原因", output)


if __name__ == "__main__":
    unittest.main()
