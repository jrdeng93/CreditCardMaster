from __future__ import annotations

import json
import re
from functools import lru_cache
from typing import Any

from .util import ROOT, compact_text, normalize_text


@lru_cache(maxsize=1)
def load_taxonomy() -> dict[str, Any]:
    return json.loads((ROOT / "data" / "category-taxonomy.json").read_text(encoding="utf-8"))


@lru_cache(maxsize=1)
def load_merchants() -> dict[str, Any]:
    return json.loads((ROOT / "data" / "merchant-aliases.json").read_text(encoding="utf-8"))


def canonicalize_category(value: Any) -> str | None:
    normalized = normalize_text(value)
    compact = compact_text(value)
    if not normalized:
        return None

    taxonomy = load_taxonomy()
    legacy = taxonomy.get("legacyCategoryMap", {}).get(normalized)
    if legacy:
        return legacy

    for category in taxonomy.get("categories", []):
        if category.get("id") == normalized:
            return category["id"]
        for alias in category.get("aliases", []):
            alias_compact = compact_text(alias)
            if normalize_text(alias) == normalized or (compact and alias_compact and compact == alias_compact):
                return category["id"]
    return None


def canonicalize_merchant(value: Any) -> dict[str, Any]:
    normalized = normalize_text(value)
    compact = compact_text(value)
    if not normalized:
        return {"canonicalMerchant": None, "canonicalCategory": None, "confidence": 0}

    for merchant in load_merchants().get("merchants", []):
        for alias in merchant.get("aliases", []):
            alias_text = normalize_text(alias)
            alias_compact = compact_text(alias)
            if normalized == alias_text or (compact and alias_compact and compact == alias_compact):
                return {
                    "canonicalMerchant": merchant.get("canonical"),
                    "canonicalCategory": merchant.get("category"),
                    "confidence": 1,
                }
            if len(alias_compact) >= 4 and alias_compact in compact:
                return {
                    "canonicalMerchant": merchant.get("canonical"),
                    "canonicalCategory": merchant.get("category"),
                    "confidence": 0.9,
                }

    category = canonicalize_category(value)
    if category:
        return {"canonicalMerchant": None, "canonicalCategory": category, "confidence": 0}
    return {"canonicalMerchant": str(value or "").strip() or None, "canonicalCategory": None, "confidence": 0.4}


def classify_query(query: str) -> dict[str, Any]:
    category = canonicalize_category(query)
    merchant = canonicalize_merchant(query)
    inferred = category or infer_canonical_category(query, "")
    return {
        "canonicalMerchant": merchant["canonicalMerchant"] if merchant["confidence"] >= 0.9 else None,
        "canonicalCategory": merchant["canonicalCategory"] if merchant["confidence"] >= 0.9 else inferred,
        "merchantConfidence": merchant["confidence"],
    }


def canonicalize_offer(offer: dict[str, Any]) -> dict[str, Any]:
    merchant = canonicalize_merchant(offer.get("merchant"))
    category = (
        merchant.get("canonicalCategory")
        or canonicalize_category(offer.get("category"))
        or infer_canonical_category(offer.get("merchant"), offer.get("rewardText") or offer.get("reward_text") or offer.get("sourceText"))
    )
    return {
        "canonicalMerchant": merchant.get("canonicalMerchant") or str(offer.get("merchant") or "").strip(),
        "canonicalCategory": category or "general_shopping",
        "categoryConfidence": merchant.get("confidence") if merchant.get("canonicalCategory") else (0.75 if category else 0.3),
    }


def infer_canonical_category(merchant: Any = "", reward_text: Any = "") -> str | None:
    text = normalize_text(f"{merchant or ''} {reward_text or ''}")
    checks = [
        ("dining", r"\b(restaurant|restaurants|dining|takeout|delivery|coffee|pizza|burger|doordash|resy)\b|餐厅|吃饭|饭店|咖啡"),
        ("hotel", r"\b(hotel|hotels|resort|lodging)\b|酒店|住宿"),
        ("airfare", r"\b(flight|airline|airfare|airport)\b|机票|航班"),
        ("travel", r"\b(travel|cruise|parking|train|airbnb|las vegas|fontainebleau)\b|旅行|旅游"),
        ("grocery", r"\b(grocery|groceries|supermarket|whole foods)\b|超市|买菜"),
        ("gas", r"\b(gas|fuel|charging)\b|加油"),
        ("drugstore", r"\b(drugstore|pharmacy|cvs|walgreens)\b|药店"),
        ("streaming", r"\b(streaming|subscription|netflix|spotify|hulu)\b"),
        ("fitness", r"\b(gym|fitness|pilates)\b|健身"),
        ("financial", r"\b(insurance|loan|creditsecure|financial)\b|保险"),
        ("department_store", r"\b(macy's|macys|saks|nordstrom|department store)\b|百货|商场"),
        ("clothing", r"\b(clothing|clothes|apparel|shoes|sneakers|suit|dress)\b|衣服|服装|鞋|西装"),
        ("electronics", r"\b(electronics|computer|laptop|phone|appliance)\b|电器|电脑|手机"),
        ("home_improvement", r"\b(furniture|hardware|home improvement)\b|家具|家居|装修"),
    ]
    for category, pattern in checks:
        if re.search(pattern, text):
            return category
    return None
