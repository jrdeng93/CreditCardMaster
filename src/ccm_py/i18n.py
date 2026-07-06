from __future__ import annotations

import re


LABELS = {
    "en": {
        "recognized": "Recognized",
        "use": "Use",
        "reasoning": "Reasoning",
        "before_paying": "Before paying",
        "relevant_offers": "Relevant offers",
        "related_offers": "Related offers (not selected)",
        "alternatives": "Alternatives",
        "no_matching_offers": "No matching offers.",
        "no_card_match": "No card-level match. Prefer an active offer above, then your best everyday card.",
        "activate": "activate",
        "activated": "activated",
        "needs_activation": "needs activation",
        "activate_offer": "Activate",
        "wallet_strategy": "Wallet strategy",
        "expires_short": "exp",
        "best_available": "Best available match from active offers and base-card rules.",
        "ccm": "CCM",
        "no_portal": "No shopping portal check for this query.",
    },
    "zh": {
        "recognized": "识别",
        "use": "使用",
        "reasoning": "原因",
        "before_paying": "付款前",
        "relevant_offers": "相关 offer",
        "related_offers": "相关 offer（未选中）",
        "alternatives": "备选卡",
        "no_matching_offers": "没有匹配的有效 offer.",
        "no_card_match": "没有匹配到卡片基础福利。优先使用上面的有效 offer，否则用日常默认卡。",
        "activate": "需激活",
        "activated": "已激活",
        "needs_activation": "需激活",
        "activate_offer": "激活",
        "wallet_strategy": "钱包策略",
        "expires_short": "到期",
        "best_available": "根据有效 offer 和卡片基础福利选择的最佳匹配。",
        "ccm": "CCM",
        "no_portal": "这个问题没有购物返现入口建议。",
    },
}


def detect_language(text: str) -> str:
    return "zh" if re.search(r"[\u3400-\u9fff]", str(text or "")) else "en"


def resolve_language(query: str = "", lang: str | None = None) -> str:
    raw = str(lang or "auto").strip().lower()
    if raw in {"en", "zh"}:
        return raw
    return detect_language(query)


def t(lang: str, key: str) -> str:
    language = lang if lang in LABELS else "en"
    return LABELS[language].get(key) or LABELS["en"].get(key) or key
