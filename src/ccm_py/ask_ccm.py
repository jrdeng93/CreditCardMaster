from __future__ import annotations

import re
import sqlite3
from typing import Any

from .benefits import ask_with_recommendations, format_search_with_recommendations
from .db import get_status
from .i18n import resolve_language, t
from .portals import build_portal_checks, format_portal_check
from .search import expiring_offers, format_offers
from .wallet import format_wallet_strategy, load_wallet_strategy


def ask_ccm(conn: sqlite3.Connection, query: str) -> dict[str, Any]:
    route = route_ask_ccm(query)
    lang = resolve_language(query)
    if route["type"] == "expiring":
        days = route.get("days") or 14
        rows = expiring_offers(conn, days, limit=8)
        return {"route": route, "output": routed_response(lang, f"未来 {days} 天快过期的 offer" if lang == "zh" else f"Offers expiring in {days} days", format_offers(rows, lang))}
    if route["type"] == "portal":
        checks = build_portal_checks({"merchant": route.get("query"), "rawQuery": query})
        body = "\n".join(format_portal_check(check, lang) for check in checks) if checks else t(lang, "no_portal")
        return {"route": route, "output": routed_response(lang, "购物返现入口" if lang == "zh" else "Shopping portal check", body)}
    if route["type"] == "wallet":
        return {"route": route, "output": routed_response(lang, "钱包策略" if lang == "zh" else "Wallet strategy", format_wallet_strategy(load_wallet_strategy()))}
    if route["type"] == "status":
        return {"route": route, "output": routed_response(lang, "本地 offer 数据状态" if lang == "zh" else "Local offer status", format_status(get_status(conn), lang))}
    result = ask_with_recommendations(conn, query)
    return {"route": route, "result": result, "output": format_search_with_recommendations(result, lang=lang)}


def route_ask_ccm(query: str) -> dict[str, Any]:
    text = str(query or "").strip()
    lower = text.lower()
    if re.search(r"\b(expiring|expires? soon|ending soon|about to expire)\b", lower) or re.search(r"快过期|即将过期|马上过期|快到期|要过期|到期", text):
        return {"type": "expiring", "days": extract_days(text), "query": text}
    if re.search(r"\b(rakuten|portal|cash\s*back portal|shopping portal)\b", lower) or re.search(r"返现入口|购物入口|导购|门户", text):
        return {"type": "portal", "query": strip_route_words(text)}
    if re.search(r"\b(wallet|strategy|point values?|points value)\b", lower) or re.search(r"钱包策略|积分估值|点数估值|持卡策略", text):
        return {"type": "wallet", "query": text}
    if re.search(r"\b(status|database|db|how many offers|offer status)\b", lower) or re.search(r"状态|数据库|多少.*offer|offer.*数量", text):
        return {"type": "status", "query": text}
    return {"type": "checkout", "query": text}


def routed_response(lang: str, title: str, body: str) -> str:
    return "\n".join([f"{t(lang, 'ccm')}: {title}", body])


def format_status(status: dict[str, Any], lang: str) -> str:
    if lang == "zh":
        lines = [f"总 offer 数: {status['total']}", f"最新更新时间: {status.get('newest') or '无'}", "按 issuer:"]
    else:
        lines = [f"Total offers: {status['total']}", f"Newest update: {status.get('newest') or 'none'}", "By issuer:"]
    lines.extend(f"- {row['issuer']}: {row['count']}" for row in status.get("byIssuer", []))
    return "\n".join(lines)


def extract_days(text: str) -> int | None:
    match = re.search(r"(\d{1,3})\s*(?:days?|天|日)", str(text or ""), re.I)
    return int(match.group(1)) if match else None


def strip_route_words(text: str) -> str:
    value = re.sub(r"\b(rakuten|portal|cash\s*back portal|shopping portal|check|search)\b", " ", str(text or ""), flags=re.I)
    value = re.sub(r"返现入口|购物入口|导购|门户|查一下|检查|搜索", " ", value)
    return re.sub(r"\s+", " ", value).strip()
