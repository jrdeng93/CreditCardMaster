#!/usr/bin/env python3
from __future__ import annotations

import sys

from ccm_py.ask_ccm import ask_ccm
from ccm_py.benefits import ask_with_recommendations, format_search_with_recommendations
from ccm_py.db import get_status, migrate, open_db
from ccm_py.portals import build_portal_checks, format_portal_check
from ccm_py.search import expiring_offers, format_offers, search_offers
from ccm_py.util import load_env


def main(argv: list[str] | None = None) -> int:
    load_env()
    args = list(argv if argv is not None else sys.argv[1:])
    command = args[0] if args else ""
    query = " ".join(args[1:])
    conn = open_db()
    migrate(conn)

    if command == "ask":
        print(ask_ccm(conn, query)["output"])
    elif command == "search":
        print(format_offers(search_offers(conn, query), "en"))
    elif command == "bestcard":
        print(format_search_with_recommendations(ask_with_recommendations(conn, query), show_offers=False))
    elif command == "rakuten":
        checks = build_portal_checks({"merchant": query, "rawQuery": query})
        print("\n".join(format_portal_check(check) for check in checks) if checks else "No Rakuten check for this query.")
    elif command == "expiring":
        days = int(args[1]) if len(args) > 1 and args[1].isdigit() else 14
        print(format_offers(expiring_offers(conn, days), "en"))
    elif command == "status":
        import json

        print(json.dumps(get_status(conn), indent=2))
    else:
        print("Usage: python3 src/ccm_py_cli.py <ask|search|bestcard|rakuten|expiring|status> [query]")
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
