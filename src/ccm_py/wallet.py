from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from .distribution import get_distribution_mode, PUBLIC_DISTRIBUTION
from .util import ROOT


DEFAULT_POINT_VALUE_CENTS = 1


def load_wallet_strategy(path: Path | None = None) -> dict[str, Any]:
    target = path or default_strategy_path()
    try:
        return normalize_strategy(json.loads(target.read_text(encoding="utf-8")))
    except FileNotFoundError:
        return normalize_strategy({})


def default_strategy_path() -> Path:
    public_path = ROOT / "data" / "wallet-strategy.public.json"
    private_path = ROOT / "data" / "wallet-strategy.json"
    if get_distribution_mode() == PUBLIC_DISTRIBUTION and public_path.exists():
        return public_path
    return private_path


def normalize_strategy(strategy: dict[str, Any] | None = None) -> dict[str, Any]:
    strategy = strategy or {}
    return {
        "pointsValueCents": {"cash": DEFAULT_POINT_VALUE_CENTS, **strategy.get("pointsValueCents", {})},
        "cardPriority": strategy.get("cardPriority", {}),
        "monthlyCategoryStrategy": strategy.get("monthlyCategoryStrategy", {}),
        "defaultFallbackCard": strategy.get("defaultFallbackCard"),
        "categoryFallbackCards": strategy.get("categoryFallbackCards", {}),
    }


def card_key(card: dict[str, Any]) -> str:
    return f"{card.get('issuer')}:{card.get('cardName')}:{card.get('cardLast4')}"


def apply_wallet_strategy_to_candidate(candidate: dict[str, Any] | None, context: dict[str, Any]) -> dict[str, Any] | None:
    if not candidate or candidate.get("type") != "base_card":
        return candidate
    strategy = normalize_strategy(context.get("strategy"))
    intent = context.get("intent") or {}
    card = candidate["card"]
    rule = candidate.get("rule") or {}
    key = card_key(card)
    score = candidate.get("score", 0)
    adjustments: list[str] = []
    currency = infer_reward_currency(card, rule)
    point_value = strategy["pointsValueCents"].get(currency, DEFAULT_POINT_VALUE_CENTS)
    point_adjustment = round((point_value - DEFAULT_POINT_VALUE_CENTS) * 8)
    if point_adjustment:
        score += point_adjustment
        adjustments.append(f"{currency.upper()} valued at {point_value} cpp")
    priority = strategy["cardPriority"].get(key)
    if priority == "preferred":
        score += 8
        adjustments.append("preferred card in wallet strategy")
    elif priority == "benefits_only" and not is_strong_merchant_or_portal_match(card, rule, intent):
        score -= 18
        adjustments.append("benefits-only card; avoid for ordinary spend")
    elif priority == "avoid_unless_merchant" and not is_merchant_match(card, intent):
        score -= 25
        adjustments.append("avoid unless merchant-specific")
    reserved = strategy["monthlyCategoryStrategy"].get(key)
    if reserved and intent.get("category") and reserved != intent.get("category"):
        score -= 35
        adjustments.append(f"reserved for {reserved} this cycle")
    return {**candidate, "score": score, "walletAdjustments": adjustments, "rewardCurrency": currency, "pointValueCents": point_value}


def apply_wallet_strategy_to_recommendations(recommendations: list[dict[str, Any]], context: dict[str, Any]) -> list[dict[str, Any]]:
    adjusted = []
    for item in recommendations:
        rule = item.get("matchedRules", [{}])[0] if item.get("matchedRules") else None
        if not rule:
            adjusted.append(item)
            continue
        confidence = 3 if item["card"].get("verified") else -5
        candidate = apply_wallet_strategy_to_candidate({
            "type": "base_card",
            "card": item["card"],
            "rule": rule,
            "score": (item.get("score") or 0) * 10 + confidence,
        }, context) or {}
        adjusted.append({**item, "adjustedScore": candidate.get("score"), "walletAdjustments": candidate.get("walletAdjustments", []), "rewardCurrency": candidate.get("rewardCurrency"), "pointValueCents": candidate.get("pointValueCents")})
    adjusted.sort(key=lambda item: -(item.get("adjustedScore") if item.get("adjustedScore") is not None else item.get("score", 0)))
    return adjusted


def infer_reward_currency(card: dict[str, Any], rule: dict[str, Any]) -> str:
    text = f"{card.get('issuer', '')} {card.get('cardName', '')} {rule.get('summary', '')}".lower()
    if "ultimate rewards" in text:
        return "ur"
    if "membership rewards" in text:
        return "mr"
    if "thankyou" in text:
        return "typ"
    if "hyatt" in text:
        return "hyatt"
    if "marriott" in text:
        return "marriott"
    if "delta" in text or "skymiles" in text:
        return "delta"
    return "cash"


def is_strong_merchant_or_portal_match(card: dict[str, Any], rule: dict[str, Any], intent: dict[str, Any]) -> bool:
    category = str(rule.get("category") or "")
    return is_merchant_match(card, intent) or "portal" in category or category in {"airfare", "hotel", "lounge"}


def is_merchant_match(card: dict[str, Any], intent: dict[str, Any]) -> bool:
    merchant = str(intent.get("merchant") or "").lower()
    return bool(merchant and any(str(alias).lower() in merchant for alias in card.get("aliases", [])))


def format_wallet_strategy(strategy: dict[str, Any] | None = None) -> str:
    normalized = normalize_strategy(strategy or load_wallet_strategy())
    lines = ["Wallet strategy", "", "Point values:"]
    lines.extend(f"- {currency.upper()}: {value} cpp" for currency, value in sorted(normalized["pointsValueCents"].items()))
    lines.extend(["", "Card priority:"])
    lines.extend(format_entries(normalized["cardPriority"]))
    lines.extend(["", "Monthly category strategy:"])
    lines.extend(format_entries(normalized["monthlyCategoryStrategy"]))
    lines.extend(["", "Fallback cards:", f"- default: {normalized['defaultFallbackCard'] or 'none'}"])
    lines.extend(f"- {category}: {key}" for category, key in sorted(normalized["categoryFallbackCards"].items()))
    return "\n".join(lines)


def format_entries(values: dict[str, Any]) -> list[str]:
    return [f"- {key}: {value}" for key, value in sorted(values.items())] or ["- none"]
