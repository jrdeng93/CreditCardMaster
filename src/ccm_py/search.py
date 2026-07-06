from __future__ import annotations

import re
import sqlite3
from typing import Any

from .canonical import canonicalize_category, classify_query
from .distribution import is_issuer_enabled
from .i18n import t
from .util import compact_text, normalize_text, title


CATEGORY_ALIASES = {
    "restaurant": ["restaurant", "dining", "meal", "coffee", "delivery", "takeout", "resy"],
    "dining": ["restaurant", "dining", "meal", "coffee", "delivery", "takeout", "resy"],
    "travel": ["travel", "hotel", "airline", "flight", "rental", "rideshare"],
    "grocery": ["grocery", "supermarket", "market"],
    "gas": ["gas", "fuel", "charging"],
    "shopping": ["shopping", "retail", "store"],
    "streaming": ["streaming", "subscription"],
}
STOPWORDS = {"s", "the", "and", "or", "at", "to", "for", "in", "on", "a", "an"}
MIN_COMPACT_MATCH_LENGTH = 4


def query_tokens(value: Any) -> list[str]:
    normalized = normalize_text(value)
    tokens = [token.strip() for token in re.split(r"[^a-z0-9]+", normalized) if len(token.strip()) > 1 and token.strip() not in STOPWORDS]
    compact = compact_text(value)
    if len(compact) >= MIN_COMPACT_MATCH_LENGTH and compact not in tokens:
        tokens.insert(0, compact)
    return tokens


def expand_terms(query: Any) -> list[str]:
    tokens = query_tokens(query)
    expanded = set(tokens)
    for token in tokens:
        for alias in CATEGORY_ALIASES.get(token, []):
            expanded.add(alias)
    return list(expanded)


def search_offers(conn: sqlite3.Connection, query: str, limit: int = 12, required_terms: list[str] | None = None) -> list[dict[str, Any]]:
    profile = classify_query(query)
    terms = expand_terms(query)
    required = [term for value in (required_terms or []) for term in query_tokens(value)]
    if not terms and not profile.get("canonicalMerchant") and not profile.get("canonicalCategory"):
        return []
    rows = conn.execute(
        """
        SELECT * FROM offers
        WHERE expires_on IS NULL OR date(expires_on) >= date('now', 'localtime')
        ORDER BY activated ASC, expires_on IS NULL ASC, date(expires_on) ASC, merchant ASC
        """
    ).fetchall()
    scored = []
    for row in rows:
        item = dict(row)
        if not is_issuer_enabled(item.get("issuer")):
            continue
        if not matches_structured_profile(item, profile):
            continue
        if not matches_required_terms(item, required):
            continue
        score = score_offer(item, terms, profile)
        if score > 0:
            scored.append((score, item))
    scored.sort(key=lambda pair: (-pair[0], str(pair[1].get("expires_on") or "9999-12-31")))
    return [item for _, item in scored[:limit]]


def search_expired_offers(conn: sqlite3.Connection, query: str, limit: int = 5, days_back: int = 30, required_terms: list[str] | None = None) -> list[dict[str, Any]]:
    profile = classify_query(query)
    terms = expand_terms(query)
    required = [term for value in (required_terms or []) for term in query_tokens(value)]
    rows = conn.execute(
        """
        SELECT * FROM offers
        WHERE expires_on IS NOT NULL
          AND date(expires_on) < date('now', 'localtime')
          AND date(expires_on) >= date('now', 'localtime', ?)
        ORDER BY date(expires_on) DESC, issuer ASC, merchant ASC
        """,
        (f"-{int(days_back)} days",),
    ).fetchall()
    scored = []
    for row in rows:
        item = dict(row)
        if not is_issuer_enabled(item.get("issuer")) or not matches_structured_profile(item, profile) or not matches_required_terms(item, required):
            continue
        score = score_offer(item, terms, profile)
        if score > 0:
            scored.append((score, item))
    scored.sort(key=lambda pair: (-pair[0], str(pair[1].get("merchant") or "")))
    return [item for _, item in scored[:limit]]


def expiring_offers(conn: sqlite3.Connection, days: int = 14, limit: int = 12) -> list[dict[str, Any]]:
    rows = conn.execute(
        """
        SELECT * FROM offers
        WHERE expires_on IS NOT NULL
          AND date(expires_on) >= date('now', 'localtime')
          AND date(expires_on) <= date('now', 'localtime', ?)
        ORDER BY date(expires_on) ASC, issuer ASC, merchant ASC
        LIMIT ?
        """,
        (f"+{int(days)} days", limit),
    ).fetchall()
    return [dict(row) for row in rows if is_issuer_enabled(row["issuer"])]


def format_offers(rows: list[dict[str, Any]], lang: str = "en") -> str:
    if not rows:
        return t(lang, "no_matching_offers")
    chunks = []
    for row in rows:
        card = f"{row.get('card_name') or row.get('issuer')} ****{row.get('card_last4')}" if row.get("card_last4") else row.get("card_name") or row.get("issuer")
        flags = []
        if row.get("activated"):
            flags.append(t(lang, "activated"))
        elif row.get("activation_required"):
            flags.append(t(lang, "needs_activation"))
        if row.get("expires_on"):
            flags.append(f"{t(lang, 'expires_short')} {row['expires_on']}")
        chunks.append("\n".join([
            f"{title(row.get('issuer'))} - {row.get('merchant')}",
            str(card),
            str(row.get("reward_text")),
            f"{row.get('category')}{' | ' + ' | '.join(flags) if flags else ''}",
        ]))
    return "\n\n".join(chunks)


def score_offer(row: dict[str, Any], terms: list[str], profile: dict[str, Any]) -> float:
    haystack = offer_haystack(row)
    compact_haystack = compact_text(haystack)
    compact_merchant = compact_text(row.get("merchant"))
    merchant_tokens = set(query_tokens(row.get("merchant")))
    category_tokens = set(query_tokens(row.get("category")))
    haystack_tokens = set(query_tokens(haystack))
    score = 0.0
    if profile.get("canonicalMerchant") and compact_text(row_canonical_merchant(row)) == compact_text(profile["canonicalMerchant"]):
        score += 40
    if profile.get("canonicalCategory") and row_canonical_category(row) == profile["canonicalCategory"]:
        score += 25
    for term in terms:
        if term in merchant_tokens:
            score += 10
        if len(term) >= MIN_COMPACT_MATCH_LENGTH and term in compact_merchant:
            score += 12
        if len(term) >= MIN_COMPACT_MATCH_LENGTH and term in normalize_text(row.get("merchant")):
            score += 8
        if term in category_tokens:
            score += 5
        if len(term) >= MIN_COMPACT_MATCH_LENGTH and term in compact_haystack:
            score += 4
        if term in haystack_tokens:
            score += 2
        if len(term) >= MIN_COMPACT_MATCH_LENGTH and term in haystack:
            score += 1
    if score == 0:
        return 0
    if row.get("activation_required") and not row.get("activated"):
        score += 1
    if row.get("max_reward"):
        score += min(float(row.get("max_reward") or 0), 50) / 50
    if row.get("reward_value"):
        score += min(float(row.get("reward_value") or 0), 25) / 25
    return score


def matches_structured_profile(row: dict[str, Any], profile: dict[str, Any]) -> bool:
    if profile.get("canonicalMerchant"):
        return compact_text(row_canonical_merchant(row)) == compact_text(profile["canonicalMerchant"])
    if profile.get("canonicalCategory"):
        return row_canonical_category(row) == profile["canonicalCategory"]
    return True


def matches_required_terms(row: dict[str, Any], required_terms: list[str]) -> bool:
    if not required_terms:
        return True
    haystack = offer_haystack(row)
    compact_haystack = compact_text(haystack)
    tokens = set(query_tokens(haystack))
    return all(term in tokens or (len(term) >= MIN_COMPACT_MATCH_LENGTH and (term in haystack or term in compact_haystack)) for term in required_terms)


def offer_haystack(row: dict[str, Any]) -> str:
    return normalize_text(" ".join(str(row.get(key) or "") for key in ["merchant", "category", "reward_text", "source_text", "issuer"]))


def row_canonical_merchant(row: dict[str, Any]) -> str:
    return row.get("canonical_merchant") or row.get("merchant") or ""


def row_canonical_category(row: dict[str, Any]) -> str:
    return row.get("canonical_category") or canonicalize_category(row.get("category")) or row.get("category") or ""
