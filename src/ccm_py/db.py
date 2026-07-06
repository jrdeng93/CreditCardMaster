from __future__ import annotations

import os
import sqlite3
from pathlib import Path
from typing import Any

from .canonical import canonicalize_offer
from .util import ROOT


def db_path() -> Path:
    raw = os.environ.get("OFFER_DB_PATH", "./data/offers.sqlite")
    path = Path(raw)
    return path if path.is_absolute() else ROOT / path


def open_db(path: Path | None = None) -> sqlite3.Connection:
    resolved = path or db_path()
    resolved.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(resolved)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode = WAL")
    conn.execute("PRAGMA busy_timeout = 5000")
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


def migrate(conn: sqlite3.Connection) -> None:
    conn.executescript(
        """
        CREATE TABLE IF NOT EXISTS offers (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          issuer TEXT NOT NULL,
          card_name TEXT,
          card_last4 TEXT,
          merchant TEXT NOT NULL,
          category TEXT NOT NULL,
          reward_type TEXT NOT NULL,
          reward_value REAL,
          reward_text TEXT NOT NULL,
          min_spend REAL,
          max_reward REAL,
          expires_on TEXT,
          activation_required INTEGER NOT NULL DEFAULT 1,
          activated INTEGER NOT NULL DEFAULT 0,
          source_text TEXT NOT NULL,
          source_url TEXT,
          raw_hash TEXT NOT NULL,
          first_seen_at TEXT NOT NULL,
          last_seen_at TEXT NOT NULL,
          UNIQUE (issuer, card_last4, raw_hash)
        );
        CREATE INDEX IF NOT EXISTS idx_offers_merchant ON offers(merchant);
        CREATE INDEX IF NOT EXISTS idx_offers_category ON offers(category);
        CREATE INDEX IF NOT EXISTS idx_offers_expires ON offers(expires_on);
        """
    )
    add_column_if_missing(conn, "offers", "canonical_merchant", "TEXT")
    add_column_if_missing(conn, "offers", "canonical_category", "TEXT")
    add_column_if_missing(conn, "offers", "category_confidence", "REAL")
    conn.executescript(
        """
        CREATE INDEX IF NOT EXISTS idx_offers_canonical_merchant ON offers(canonical_merchant);
        CREATE INDEX IF NOT EXISTS idx_offers_canonical_category ON offers(canonical_category);
        CREATE TABLE IF NOT EXISTS watchlist (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          kind TEXT NOT NULL,
          value TEXT NOT NULL,
          canonical_merchant TEXT,
          canonical_category TEXT,
          created_at TEXT NOT NULL,
          UNIQUE (kind, value)
        );
        """
    )
    backfill_canonical_offers(conn)
    conn.commit()


def add_column_if_missing(conn: sqlite3.Connection, table: str, column: str, definition: str) -> None:
    columns = conn.execute(f"PRAGMA table_info({table})").fetchall()
    if any(row["name"] == column for row in columns):
        return
    conn.execute(f"ALTER TABLE {table} ADD COLUMN {column} {definition}")


def backfill_canonical_offers(conn: sqlite3.Connection) -> None:
    rows = conn.execute(
        "SELECT id, merchant, category, reward_text AS rewardText, source_text AS sourceText FROM offers"
    ).fetchall()
    for row in rows:
        canonical = canonicalize_offer(dict(row))
        conn.execute(
            """
            UPDATE offers
            SET canonical_merchant = ?, canonical_category = ?, category_confidence = ?
            WHERE id = ?
            """,
            (
                canonical["canonicalMerchant"],
                canonical["canonicalCategory"],
                canonical["categoryConfidence"],
                row["id"],
            ),
        )


def get_status(conn: sqlite3.Connection) -> dict[str, Any]:
    total = conn.execute("SELECT count(*) AS count FROM offers").fetchone()["count"]
    by_issuer = [dict(row) for row in conn.execute("SELECT issuer, count(*) AS count FROM offers GROUP BY issuer ORDER BY issuer")]
    newest = conn.execute("SELECT max(last_seen_at) AS newest FROM offers").fetchone()["newest"]
    return {"total": total, "byIssuer": by_issuer, "newest": newest}
