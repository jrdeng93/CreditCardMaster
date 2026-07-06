from __future__ import annotations

import os
import re
from typing import Any

from .util import compact_text


DEFAULT_RAKUTEN_TEMPLATE = "https://www.rakuten.com/{domain}"
RAKUTEN_STORE_SLUGS = {
    "macys": "macys",
    "macy's": "macys",
    "macy": "macys",
    "nike": "nike",
    "nike.com": "nike",
    "lululemon": "lululemon",
    "lululemon.com": "lululemon",
    "lululemom": "lululemon",
    "visible": "visible",
    "visible.com": "visible",
    "visiblebyverizon": "visible",
}
PORTAL_CATEGORIES = {"department_store", "clothing", "electronics", "home_improvement", "general_shopping", "hotel", "travel", "entertainment", "streaming"}
LOW_VALUE_CATEGORIES = {"dining", "grocery", "gas", "drugstore", "airfare", "financial", "fitness"}


def build_portal_checks(intent: dict[str, Any]) -> list[dict[str, str]]:
    if os.environ.get("RAKUTEN_ENABLED", "1") == "0":
        return []
    query = portal_query(intent)
    if not query or not should_suggest_portal(intent):
        return []
    return [{
        "provider": "Rakuten",
        "label": "Rakuten",
        "query": query,
        "url": build_rakuten_url(query) if intent.get("merchant") else os.environ.get("RAKUTEN_HOME_URL", "https://www.rakuten.com/"),
        "reason": "Open the merchant's Rakuten store page before clicking through." if intent.get("merchant") else "Open Rakuten and verify the current cash back rate before buying.",
    }]


def format_portal_check(check: dict[str, str], lang: str = "en") -> str:
    if lang == "zh":
        return f"检查 {check['label']} 返现入口: {check['url']}"
    return f"Check {check['label']} cash back: {check['url']}"


def portal_query(intent: dict[str, Any]) -> str:
    return str(intent.get("merchant") or intent.get("category") or intent.get("offerSearchQuery") or intent.get("rawQuery") or "").strip()


def should_suggest_portal(intent: dict[str, Any]) -> bool:
    if intent.get("merchant"):
        return True
    category = str(intent.get("category") or "").strip()
    return bool(category and category not in LOW_VALUE_CATEGORIES and category in PORTAL_CATEGORIES)


def build_rakuten_url(query: str) -> str:
    direct = direct_rakuten_store_url(query)
    if direct:
        return direct
    template = os.environ.get("RAKUTEN_SEARCH_URL_TEMPLATE", DEFAULT_RAKUTEN_TEMPLATE)
    domain = merchant_domain_candidate(query)
    if "{query}" in template:
        return template.replace("{query}", query.replace(" ", "%20"))
    if "{domain}" in template:
        return template.replace("{domain}", domain)
    return f"{template}{query.replace(' ', '%20')}"


def direct_rakuten_store_url(query: str) -> str | None:
    slug = RAKUTEN_STORE_SLUGS.get(normalize_merchant_key(query))
    return f"https://www.rakuten.com/shop/{slug}" if slug else None


def merchant_domain_candidate(query: str) -> str:
    cleaned = str(query or "").strip().lower()
    if re.match(r"^[a-z0-9.-]+\.[a-z]{2,}$", cleaned):
        return cleaned
    return f"{normalize_merchant_key(query)}.com"


def normalize_merchant_key(query: str) -> str:
    text = str(query or "").strip().lower().replace("’", "'").replace("‘", "'").replace("`", "'").replace("´", "'")
    text = re.sub(r"^www\.", "", text)
    text = re.sub(r"[^a-z0-9.']+", "", text)
    return re.sub(r"\.com$", "", text)
