from __future__ import annotations

import json
import re
import sqlite3
from pathlib import Path
from typing import Any

from .canonical import canonicalize_category, classify_query
from .distribution import get_distribution_mode, PUBLIC_DISTRIBUTION
from .i18n import resolve_language, t
from .intent import build_offer_search_query, build_recommendation_query, parse_intent
from .portals import build_portal_checks, format_portal_check
from .rag_client import retrieve_rag_context
from .search import expand_terms, format_offers, query_tokens, search_expired_offers, search_offers
from .util import ROOT, compact_text, normalize_text, title
from .wallet import apply_wallet_strategy_to_candidate, apply_wallet_strategy_to_recommendations, card_key, load_wallet_strategy


GENERIC_QUERY_TERMS = {
    "buy", "card", "cashback", "check", "deal", "offer", "portal",
    "purchase", "rakuten", "shop", "shopping", "store", "use", "which",
}


def load_card_benefits(path: Path | None = None) -> dict[str, Any]:
    target = path or default_benefits_path()
    payload = json.loads(target.read_text(encoding="utf-8"))
    cards = [dict(card) for card in payload.get("cards", [])]
    by_key = {card_key(card): card for card in cards}
    for card in cards:
        source_key = card.get("copyBenefitsFrom")
        if not source_key:
            continue
        source = by_key.get(source_key)
        if not source:
            continue
        for key in ["bestFor", "rules", "notes", "sourceUrl", "verified", "lastVerifiedAt", "verificationNote"]:
            card[key] = source.get(key)
    return {"updatedAt": payload.get("updatedAt"), "cards": cards}


def default_benefits_path() -> Path:
    public_path = ROOT / "data" / "card-benefits.public.json"
    private_path = ROOT / "data" / "card-benefits.json"
    if get_distribution_mode() == PUBLIC_DISTRIBUTION and public_path.exists():
        return public_path
    return private_path


def ask_with_recommendations(conn: sqlite3.Connection, query: str) -> dict[str, Any]:
    intent = parse_intent(query)
    return search_with_recommendations(conn, query, intent)


def search_with_recommendations(conn: sqlite3.Connection, query: str, intent: dict[str, Any] | None = None) -> dict[str, Any]:
    intent = intent or {"rawQuery": query, "offerSearchQuery": query, "recommendationQuery": query, "parser": "raw"}
    rag_context = retrieve_rag_context(query)
    intent = enrich_intent_from_rag(intent, query, rag_context)
    offer_search_query = intent.get("offerSearchQuery") or query
    required_terms = query_tokens(intent.get("merchant")) if intent.get("merchant") else []
    offers = search_offers(conn, offer_search_query, limit=8, required_terms=required_terms)
    enriched = enrich_intent_from_offer_matches(intent, query, offers)
    if enriched is not intent:
        intent = enriched
        offer_search_query = intent.get("offerSearchQuery") or query
        required_terms = query_tokens(intent.get("merchant")) if intent.get("merchant") else []
        offers = search_offers(conn, offer_search_query, limit=8, required_terms=required_terms)

    recommendation_query = intent.get("recommendationQuery") or offer_search_query
    expired = [] if offers else search_expired_offers(conn, offer_search_query, limit=3, required_terms=required_terms)
    wallet_strategy = load_wallet_strategy()
    recommendation_limit = 5
    recommendations = apply_wallet_strategy_to_recommendations(
        recommend_cards(recommendation_query, limit=max(12, recommendation_limit * 4)),
        {"intent": intent, "strategy": wallet_strategy},
    )
    final_recommendations = recommendations or apply_wallet_strategy_to_recommendations(
        recommend_fallback_cards(limit=recommendation_limit, strategy=wallet_strategy, intent=intent),
        {"intent": intent, "strategy": wallet_strategy},
    )
    result = {
        "intent": intent,
        "offers": offers,
        "expiredOffers": expired,
        "recommendations": final_recommendations,
        "walletStrategy": wallet_strategy,
        "portalChecks": build_portal_checks(intent),
        "ragContext": rag_context,
    }
    result["decision"] = build_decision(result)
    return result


def enrich_intent_from_rag(intent: dict[str, Any], query: str, rag_context: dict[str, Any] | None) -> dict[str, Any]:
    merchant = (rag_context or {}).get("merchant")
    if intent.get("merchant") or not merchant or float(merchant.get("score") or 0) < 1:
        return intent
    updated = {**intent}
    updated["merchant"] = merchant.get("merchant")
    updated["category"] = merchant.get("category") or intent.get("category")
    updated["offerSearchQuery"] = merchant.get("merchant")
    updated["recommendationQuery"] = " ".join(str(value).strip() for value in [merchant.get("merchant"), merchant.get("category"), intent.get("rawQuery") or query] if str(value or "").strip())
    updated["parser"] = f"{intent.get('parser') or 'unknown'}+rag"
    updated["inferredFromRag"] = True
    return updated


def enrich_intent_from_offer_matches(intent: dict[str, Any], query: str, offers: list[dict[str, Any]]) -> dict[str, Any]:
    if intent.get("merchant") or not offers:
        return intent
    match = infer_merchant_from_offer_matches(query, offers)
    if not match:
        return intent
    merchant = match.get("canonicalMerchant") or match.get("merchant")
    category = match.get("canonicalCategory") or canonicalize_category(match.get("category")) or intent.get("category")
    updated = {**intent, "merchant": merchant, "category": category, "offerSearchQuery": merchant}
    updated["recommendationQuery"] = " ".join(str(value).strip() for value in [merchant, category, intent.get("rawQuery") or query] if str(value or "").strip())
    updated["parser"] = f"{intent.get('parser') or 'unknown'}+offer_match"
    updated["inferredFromOffers"] = True
    return updated


def infer_merchant_from_offer_matches(query: str, offers: list[dict[str, Any]]) -> dict[str, Any] | None:
    terms = [term for term in query_tokens(query) if term not in GENERIC_QUERY_TERMS]
    compact_query = compact_text(query)
    if not terms and len(compact_query) < 4:
        return None
    merchants: dict[str, dict[str, Any]] = {}
    for row in offers:
        score = merchant_query_match_score(row, terms, compact_query)
        if score <= 0:
            continue
        key = compact_text(row.get("canonical_merchant") or row.get("merchant"))
        current = merchants.setdefault(key, {
            "score": 0,
            "count": 0,
            "merchant": row.get("merchant"),
            "canonicalMerchant": row.get("canonical_merchant"),
            "category": row.get("category"),
            "canonicalCategory": row.get("canonical_category"),
        })
        current["score"] += score
        current["count"] += 1
    ranked = sorted(merchants.values(), key=lambda item: (-item["score"], -item["count"], str(item["merchant"])))
    if not ranked or ranked[0]["score"] < 2:
        return None
    if len(ranked) > 1 and ranked[1]["score"] == ranked[0]["score"] and ranked[1]["count"] == ranked[0]["count"]:
        return None
    return ranked[0]


def merchant_query_match_score(row: dict[str, Any], terms: list[str], compact_query: str) -> int:
    merchant = str(row.get("canonical_merchant") or row.get("merchant") or "")
    merchant_tokens = set(query_tokens(merchant))
    compact_merchant = compact_text(merchant)
    score = 0
    for term in terms:
        if term in merchant_tokens:
            score += 4
        if len(term) >= 4 and term in compact_merchant:
            score += 3
    if len(compact_query) >= 4 and compact_query not in GENERIC_QUERY_TERMS and compact_query in compact_merchant:
        score += 5
    return score


def recommend_cards(query: str, limit: int = 5, benefit_data: dict[str, Any] | None = None) -> list[dict[str, Any]]:
    context = build_benefit_query_context(query)
    data = benefit_data or load_card_benefits()
    items = []
    for card in data.get("cards", []):
        rule_matches = match_rules(card, context)
        alias_score = match_aliases(card, context)
        matched_rules = rule_matches if rule_matches else (card_summary_rules(card) if alias_score else [])
        score = sum(rule.get("score") or 0 for rule in matched_rules) + alias_score
        if score > 0:
            items.append({"card": card, "matchedRules": matched_rules, "score": score})
    items.sort(key=lambda item: (-item["score"], card_label(item["card"])))
    return items[:limit]


def build_decision(result: dict[str, Any]) -> dict[str, Any]:
    offer_candidates = [build_offer_candidate(row, result.get("intent") or {}) for row in result.get("offers", []) if is_offer_eligible_for_best_choice(row, result.get("intent") or {})]
    base_candidates = []
    for recommendation in result.get("recommendations", []):
        candidate = build_base_card_candidate(recommendation)
        if not candidate:
            continue
        if recommendation.get("adjustedScore") is not None:
            candidate = {**candidate, "score": recommendation["adjustedScore"], "walletAdjustments": recommendation.get("walletAdjustments", []), "rewardCurrency": recommendation.get("rewardCurrency"), "pointValueCents": recommendation.get("pointValueCents")}
        else:
            candidate = apply_wallet_strategy_to_candidate(candidate, {"intent": result.get("intent"), "strategy": result.get("walletStrategy")})
        base_candidates.append(candidate)
    candidates = [item for item in [*offer_candidates, *base_candidates] if item]
    candidates.sort(key=lambda item: (-item.get("score", 0), item.get("label", "")))
    if not candidates:
        return {
            "type": "fallback",
            "label": "Your normal fallback card",
            "summary": "No matching offer or base-card rule found.",
            "reason": "Use your normal fallback card, or add a manual offer if this is a targeted bonus.",
            "score": 0,
        }
    selected = candidates[0]
    if selected.get("type") == "base_card" and has_amount_blocked_offer(result.get("offers", []), result.get("intent") or {}):
        return {**selected, "reason": "Matching offer does not meet this purchase amount; use the card recommendation instead."}
    return selected


def build_offer_candidate(row: dict[str, Any], intent: dict[str, Any]) -> dict[str, Any]:
    activation_penalty = 8 if row.get("activation_required") and not row.get("activated") else 0
    manual_bonus = 8 if str(row.get("source_text") or "").lower().startswith("manual") else 0
    merchant_bonus = 600 if intent.get("merchant") else 0
    score = 70 + merchant_bonus + reward_value_score(row) + manual_bonus - activation_penalty
    card = f"****{row.get('card_last4')}" if row.get("card_last4") else row.get("card_name") or ""
    flags = []
    if row.get("activation_required") and not row.get("activated"):
        flags.append("activate first")
    if row.get("expires_on"):
        flags.append(f"expires {row['expires_on']}")
    return {
        "type": "offer",
        "row": row,
        "label": " ".join(value for value in [title(row.get("issuer")), card] if value),
        "summary": f"{row.get('merchant')}: {row.get('reward_text')}",
        "reason": f"Offer match; {', '.join(flags)}." if flags else "Offer match beats normal base earning.",
        "score": score,
    }


def build_base_card_candidate(item: dict[str, Any]) -> dict[str, Any] | None:
    if not item.get("matchedRules"):
        return None
    rule = item["matchedRules"][0]
    card = item["card"]
    confidence = 1 if card.get("lastVerifiedAt") else (3 if card.get("verified") else -5)
    reason = "No matching offer found; use this fallback card for uncategorized spend." if rule.get("fallback") else ("Base card benefit match." if card.get("verified") or card.get("lastVerifiedAt") else "Base card benefit match, but verify current terms before relying on it.")
    return {"type": "base_card", "card": card, "rule": rule, "label": card_label(card), "summary": rule.get("summary"), "reason": reason, "score": (rule.get("score") or 0) * 10 + confidence}


def is_offer_eligible_for_best_choice(row: dict[str, Any], intent: dict[str, Any]) -> bool:
    if is_below_offer_minimum(row, intent):
        return False
    return bool(intent.get("merchant") or str(row.get("source_text") or "").lower().startswith("manual"))


def has_amount_blocked_offer(rows: list[dict[str, Any]], intent: dict[str, Any]) -> bool:
    return any(is_below_offer_minimum(row, intent) for row in rows)


def is_below_offer_minimum(row: dict[str, Any], intent: dict[str, Any]) -> bool:
    if intent.get("amount") in {None, ""}:
        return False
    try:
        amount = float(intent.get("amount"))
        min_spend = float(row.get("min_spend") or 0)
    except (TypeError, ValueError):
        return False
    return min_spend > 0 and amount < min_spend


def reward_value_score(row: dict[str, Any]) -> float:
    reward_type = row.get("reward_type")
    if reward_type in {"percent", "multiplier"}:
        return min(float(row.get("reward_value") or 0) * 6, 45)
    if reward_type == "fixed_cash":
        if row.get("min_spend") and row.get("max_reward"):
            return min((float(row["max_reward"]) / float(row["min_spend"])) * 100 * 5, 45)
        return 18
    match = re.search(r"\b(\d+(?:\.\d+)?)\s*x\b", str(row.get("reward_text") or "").lower())
    return min(float(match.group(1)) * 6, 45) if match else 8


def format_search_with_recommendations(result: dict[str, Any], lang: str | None = None, show_offers: bool = True) -> str:
    language = resolve_language(result.get("intent", {}).get("rawQuery") or result.get("intent", {}).get("recommendationQuery") or "", lang)
    sections: list[str] = []
    intent = result.get("intent") or {}
    intent_parts = [intent.get("merchant") or intent.get("category"), f"${intent.get('amount')}" if intent.get("amount") else None]
    intent_parts = [str(item) for item in intent_parts if item]
    if intent_parts:
        sections.append(f"{t(language, 'recognized')}: {' / '.join(intent_parts)}")
    if result.get("decision"):
        sections.append(format_action_decision(result, language))
    if show_offers:
        displayed = offers_for_compact_display(result, 5)
        sections.extend(["", f"{t(language, 'relevant_offers' if displayed['selectedOnly'] else 'related_offers')}:", format_compact_offers(displayed["rows"], language)])
    alternatives = alternative_recommendations(result)[:5]
    if alternatives:
        sections.extend(["", f"{t(language, 'alternatives')}:", format_compact_recommendations(alternatives, language)])
    return "\n".join(sections)


def format_action_decision(result: dict[str, Any], lang: str) -> str:
    decision = result["decision"]
    before_paying = before_paying_items(result, lang)
    lines = [
        f"{t(lang, 'use')}:",
        f"{decision.get('label')} - {localize_benefit_summary(decision.get('summary'), lang)}",
        "",
        f"{t(lang, 'reasoning')}:",
        f"- {localize_decision_reason(decision.get('reason'), lang) or t(lang, 'best_available')}",
    ]
    lines.extend(f"- {t(lang, 'wallet_strategy')}: {localize_wallet_adjustment(item, lang)}" for item in decision.get("walletAdjustments", []))
    if before_paying:
        lines.extend(["", f"{t(lang, 'before_paying')}:"])
        lines.extend(f"- {item}" for item in before_paying)
    return "\n".join(line for line in lines if line is not None)


def before_paying_items(result: dict[str, Any], lang: str) -> list[str]:
    items = []
    selected = result.get("decision", {}).get("row") if result.get("decision", {}).get("type") == "offer" else None
    if selected and selected.get("activation_required") and not selected.get("activated"):
        issuer_card = " ".join(value for value in [title(selected.get("issuer")), f"****{selected.get('card_last4')}" if selected.get("card_last4") else ""] if value)
        items.append(f"{t(lang, 'activate_offer')} {issuer_card} offer: {selected.get('merchant')}")
    for check in result.get("portalChecks", []):
        items.append(format_portal_check(check, lang))
    return items


def format_compact_offers(rows: list[dict[str, Any]], lang: str) -> str:
    if not rows:
        return t(lang, "no_matching_offers")
    lines = []
    for row in rows:
        card = f"****{row.get('card_last4')}" if row.get("card_last4") else row.get("card_name") or ""
        flags = []
        if row.get("activation_required") and not row.get("activated"):
            flags.append(t(lang, "activate"))
        if row.get("expires_on"):
            flags.append(f"{t(lang, 'expires_short')} {row['expires_on']}")
        lines.append(f"- {' '.join(value for value in [title(row.get('issuer')), card] if value)}: {row.get('merchant')} - {row.get('reward_text')}{' (' + ', '.join(flags) + ')' if flags else ''}")
    return "\n".join(lines)


def format_compact_recommendations(items: list[dict[str, Any]], lang: str) -> str:
    if not items:
        return t(lang, "no_card_match")
    lines = []
    for index, item in enumerate(items, start=1):
        rule = item.get("matchedRules", [{}])[0] if item.get("matchedRules") else {}
        wallet = "; ".join(localize_wallet_adjustment(adjustment, lang) for adjustment in item.get("walletAdjustments", []))
        wallet_text = f" [{wallet}]" if wallet else ""
        lines.append(f"{index}. {card_label(item['card'])} - {localize_benefit_summary(rule.get('summary') or 'benefit match', lang)}{wallet_text}")
    return "\n".join(lines)


def localize_decision_reason(reason: str | None, lang: str) -> str | None:
    if not reason or lang != "zh":
        return reason
    if "activate first" in reason:
        return reason.replace("Offer match; activate first", "匹配到 offer；需先激活")
    if "Offer match beats normal base earning" in reason:
        return "匹配到有效 offer，优先于普通卡片基础返利。"
    if "Base card benefit match, but verify current terms" in reason:
        return "匹配到卡片基础福利，但使用前需要核实当前条款。"
    if "Base card benefit match" in reason:
        return "匹配到卡片基础福利。"
    if "Matching offer does not meet this purchase amount" in reason:
        return "匹配到的 offer 不满足本次消费金额门槛；建议改用卡片推荐。"
    if "No matching offer found" in reason:
        return "没有匹配到有效 offer；建议使用这张日常兜底卡。"
    return reason


def localize_benefit_summary(summary: str | None, lang: str) -> str:
    if not summary or lang != "zh":
        return str(summary or "")
    text = str(summary)
    replacements = [
        (r"(\d+(?:\.\d+)?)X Ultimate Rewards points on dining\.", r"餐饮消费赚 \1 倍 Ultimate Rewards 点数。"),
        (r"(\d+(?:\.\d+)?)X ThankYou Points at restaurants outside Citi Nights windows\.", r"非 Citi Nights 时段餐厅消费赚 \1 倍 ThankYou Points。"),
        (r"(\d+(?:\.\d+)?)X ThankYou Points on all other purchases\.", r"其它日常消费赚 \1 倍 ThankYou Points。"),
        (r"(\d+(?:\.\d+)?)% cash back on dining\.", r"餐饮消费 \1% 返现。"),
        (r"(\d+(?:\.\d+)?)% cash back on all other purchases\.", r"其它日常消费 \1% 返现。"),
        (r"Good when this purchase falls into your top eligible spend category for the billing cycle\.", "如果本账单周期这是你的最高合资格消费类别，这张卡适合使用。"),
    ]
    for pattern, replacement in replacements:
        text = re.sub(pattern, replacement, text, flags=re.I)
    return text


def localize_wallet_adjustment(value: str | None, lang: str) -> str:
    if not value or lang != "zh":
        return str(value or "")
    text = str(value)
    text = re.sub(r"\b([A-Z]+) valued at ([\d.]+) cpp\b", r"\1 按 \2 美分/点估值", text)
    text = re.sub(r"preferred card in wallet strategy", "钱包策略优先卡", text, flags=re.I)
    text = re.sub(r"benefits-only card; avoid for ordinary spend", "偏权益卡，普通消费尽量避免", text, flags=re.I)
    text = re.sub(r"avoid unless merchant-specific", "除非有商户专属权益，否则尽量避免", text, flags=re.I)
    text = re.sub(r"reserved for ([a-z_]+) this cycle", r"本周期保留给 \1 类别", text, flags=re.I)
    return text


def build_benefit_query_context(query: str) -> dict[str, Any]:
    profile = classify_query(query)
    return {
        "query": query,
        "profile": profile,
        "terms": expand_terms(query),
        "normalizedQuery": normalize_text(query),
        "canonicalCategory": profile.get("canonicalCategory"),
        "canonicalMerchant": profile.get("canonicalMerchant"),
    }


def match_rules(card: dict[str, Any], context: dict[str, Any]) -> list[dict[str, Any]]:
    matches = []
    for rule in card.get("rules", []):
        if is_fallback_rule(rule) or not rule_requirements_matched(rule, context):
            continue
        if rule_matches_category(rule, context) or rule_matches_keyword(rule, context):
            matches.append(with_canonical_category(rule))
    matches.sort(key=lambda rule: -(rule.get("score") or 0))
    return matches


def recommend_fallback_cards(limit: int = 3, strategy: dict[str, Any] | None = None, intent: dict[str, Any] | None = None, benefit_data: dict[str, Any] | None = None) -> list[dict[str, Any]]:
    data = benefit_data or load_card_benefits()
    strategy = strategy or {}
    intent = intent or {}
    preferred_keys = []
    if intent.get("category") and strategy.get("categoryFallbackCards", {}).get(intent["category"]):
        preferred_keys.append(strategy["categoryFallbackCards"][intent["category"]])
    if strategy.get("defaultFallbackCard"):
        preferred_keys.append(strategy["defaultFallbackCard"])
    preferred = [item for key in dict.fromkeys(preferred_keys) if (item := build_fallback_recommendation_for_key(data, key))]
    seen = {card_key(item["card"]) for item in preferred}
    catalog = []
    for card in data.get("cards", []):
        for rule in card.get("rules", []):
            if is_fallback_rule(rule) and card_key(card) not in seen:
                catalog.append({"card": card, "matchedRules": [{**with_canonical_category(rule), "fallback": True}], "score": rule.get("score") or 1})
    rows = [*preferred, *catalog]
    rows.sort(key=lambda item: (-item.get("score", 0), card_label(item["card"])))
    return rows[:limit]


def build_fallback_recommendation_for_key(data: dict[str, Any], key: str) -> dict[str, Any] | None:
    for card in data.get("cards", []):
        if card_key(card) != key:
            continue
        rule = next((rule for rule in card.get("rules", []) if is_fallback_rule(rule)), {"category": "everyday", "summary": "Fallback card from wallet strategy.", "score": 4, "fallback": True})
        return {"card": card, "matchedRules": [{**with_canonical_category(rule), "fallback": True}], "score": (rule.get("score") or 1) + 50}
    return None


def offers_for_compact_display(result: dict[str, Any], limit: int) -> dict[str, Any]:
    offers = result.get("offers", [])
    if result.get("decision", {}).get("type") == "offer":
        selected = result["decision"].get("row") or {}
        rows = [selected] + [row for row in offers if row.get("id") != selected.get("id")]
        return {"selectedOnly": True, "rows": rows[:limit]}
    if result.get("intent", {}).get("merchant"):
        return {"selectedOnly": True, "rows": offers[:limit]}
    return {"selectedOnly": False, "rows": offers[:min(limit, 3)]}


def alternative_recommendations(result: dict[str, Any]) -> list[dict[str, Any]]:
    if result.get("decision", {}).get("type") != "base_card":
        return result.get("recommendations", [])
    selected = result["decision"]["card"]
    return [item for item in result.get("recommendations", []) if card_key(item["card"]) != card_key(selected)]


def is_fallback_rule(rule: dict[str, Any]) -> bool:
    category = str(rule.get("category") or "").lower()
    return bool(rule.get("fallback") or category in {"everyday", "general_spend", "uncategorized"})


def rule_requirements_matched(rule: dict[str, Any], context: dict[str, Any]) -> bool:
    required = rule.get("requiresAny")
    return not required or any(normalize_text(keyword) in context["terms"] or normalize_text(keyword) in context["normalizedQuery"] for keyword in required)


def rule_matches_category(rule: dict[str, Any], context: dict[str, Any]) -> bool:
    rule_category = canonicalize_category(rule.get("category"))
    return bool(rule_category and context.get("canonicalCategory") and rule_category == context["canonicalCategory"])


def rule_matches_keyword(rule: dict[str, Any], context: dict[str, Any]) -> bool:
    for keyword in rule.get("keywords", []):
        normalized = normalize_text(keyword)
        keyword_category = canonicalize_category(keyword)
        if normalized in context["terms"] or normalized in context["normalizedQuery"] or (keyword_category and context.get("canonicalCategory") and keyword_category == context["canonicalCategory"]):
            return True
    return False


def with_canonical_category(rule: dict[str, Any]) -> dict[str, Any]:
    return {**rule, "canonicalCategory": canonicalize_category(rule.get("category"))}


def match_aliases(card: dict[str, Any], context: dict[str, Any]) -> int:
    score = 0
    for alias in card.get("aliases", []):
        normalized = normalize_text(alias)
        if normalized in context["terms"] or normalized in context["normalizedQuery"]:
            score += 8
    return score


def card_summary_rules(card: dict[str, Any]) -> list[dict[str, Any]]:
    rules = card.get("rules", [])
    fallback = next((rule for rule in rules if is_fallback_rule(rule)), None)
    rule = fallback or (rules[0] if rules else None)
    return [{**with_canonical_category(rule), "score": rule.get("score") or 1}] if rule else []


def card_label(card: dict[str, Any]) -> str:
    issuer = title(card.get("issuer"))
    name = str(card.get("cardName") or "")
    label = name if name.lower().startswith(str(card.get("issuer") or "").lower()) else f"{issuer} {name}".strip()
    return f"{label} ****{card.get('cardLast4')}" if card.get("cardLast4") else label
