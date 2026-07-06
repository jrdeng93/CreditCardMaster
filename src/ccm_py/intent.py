from __future__ import annotations

from typing import Any

from .canonical import canonicalize_category, canonicalize_merchant, classify_query
from .util import normalize_text, parse_amount


CATEGORY_KEYWORDS = [
    ("dining", ["restaurant", "dining", "dinner", "lunch", "brunch", "supper", "餐厅", "吃饭", "晚饭", "午饭", "外卖", "咖啡", "奶茶", "takeout", "delivery"]),
    ("hotel", ["hotel", "酒店", "hyatt", "marriott", "hilton", "resort", "住宿"]),
    ("airfare", ["flight", "airline", "机票", "航班", "delta", "united", "american airlines", "aa"]),
    ("travel", ["travel", "旅行", "旅游", "租车", "rental car", "uber", "lyft", "turo"]),
    ("grocery", ["grocery", "超市", "买菜", "supermarket"]),
    ("gas", ["gas", "加油", "fuel", "charging", "ev"]),
    ("drugstore", ["drugstore", "药店", "cvs", "walgreens", "pharmacy"]),
    ("department_store", ["department store", "百货", "百货店", "商场", "macy", "macys", "macy's"]),
    ("clothing", ["clothing", "clothes", "apparel", "衣服", "服装", "鞋", "西装"]),
    ("general_shopping", ["shopping", "买", "购物", "retail", "store"]),
    ("streaming", ["streaming", "netflix", "spotify", "hulu", "subscription"]),
]
KNOWN_MERCHANTS = [
    "hyatt", "marriott", "delta", "united", "american airlines", "expedia",
    "hotels.com", "turo", "lyft", "uber", "ray-ban", "raymour", "popeyes",
    "resy", "peets", "cvs", "walgreens", "walmart", "shell", "bp",
]


def parse_intent(query: str) -> dict[str, Any]:
    # Python v1 intentionally mirrors the JS deterministic fallback. The JS LLM parser
    # remains available in the JavaScript runtime.
    return fallback_intent(query)


def fallback_intent(query: str) -> dict[str, Any]:
    normalized = normalize_text(query)
    merchant = find_merchant(normalized)
    category = find_category(normalized, merchant)
    intent = {
        "rawQuery": query,
        "merchant": merchant,
        "category": category,
        "intent": "purchase_advice",
        "amount": parse_amount(query),
        "wantsOffers": True,
        "wantsCardRecommendation": True,
        "parser": "python_fallback",
    }
    intent["offerSearchQuery"] = build_offer_search_query(intent)
    intent["recommendationQuery"] = build_recommendation_query(intent)
    return intent


def build_offer_search_query(intent: dict[str, Any]) -> str:
    return str(intent.get("merchant") or intent.get("category") or intent.get("rawQuery") or "").strip()


def build_recommendation_query(intent: dict[str, Any]) -> str:
    values = [intent.get("merchant"), intent.get("category"), intent.get("rawQuery")]
    return " ".join(str(value).strip() for value in values if str(value or "").strip()) or str(intent.get("rawQuery") or "").strip()


def find_merchant(normalized_query: str) -> str | None:
    classified = classify_query(normalized_query)
    if classified.get("canonicalMerchant"):
        return classified["canonicalMerchant"]
    for merchant in KNOWN_MERCHANTS:
        if merchant in normalized_query:
            known = canonicalize_merchant(merchant)
            return known["canonicalMerchant"] if known.get("confidence", 0) >= 0.9 else merchant
    return None


def find_category(normalized_query: str, merchant: str | None = None) -> str | None:
    classified = classify_query(normalized_query)
    if classified.get("canonicalCategory"):
        return classified["canonicalCategory"]
    for category, keywords in CATEGORY_KEYWORDS:
        if any(keyword in normalized_query for keyword in keywords):
            return category
    if merchant in {"hyatt", "marriott"}:
        return "hotel"
    if merchant in {"delta", "united", "american airlines"}:
        return "airfare"
    return canonicalize_category(normalized_query)
