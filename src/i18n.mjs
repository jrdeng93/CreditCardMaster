const SUPPORTED_LANGUAGES = new Set(["en", "zh"]);

const LABELS = {
  en: {
    recognized: "Recognized",
    use: "Use",
    reasoning: "Reasoning",
    beforePaying: "Before paying",
    relevantOffers: "Relevant offers",
    relatedOffers: "Related offers (not selected)",
    alternatives: "Alternatives",
    offers: "Offers",
    recentlyExpired: "Recently expired",
    cardRecommendations: "Card recommendations",
    noMatchingOffers: "No matching offers.",
    noMatchingOffersFound: "No matching offers found.",
    noCardMatch: "No card-level match. Prefer an active offer above, then your best everyday card.",
    noCardBenefitMatch: "No card-level benefit match found. Use the best offer above, or default to a flexible everyday/travel card.",
    activate: "activate",
    activated: "activated",
    needsActivation: "needs activation",
    activateOffer: "Activate",
    expiresShort: "exp",
    verified: "verified",
    reviewed: "reviewed",
    verify: "verify",
    needsVerification: "needs verification",
    note: "Note",
    addOn: "Add-on",
    walletStrategy: "Wallet strategy",
    watchlistMatch: "Watchlist match",
    bestAvailable: "Best available match from active offers and base-card rules.",
    ccmRoute: "CCM",
    noPortalCheck: "No shopping portal check for this query.",
  },
  zh: {
    recognized: "识别",
    use: "使用",
    reasoning: "原因",
    beforePaying: "付款前",
    relevantOffers: "相关 offer",
    relatedOffers: "相关 offer（未选中）",
    alternatives: "备选卡",
    offers: "Offers",
    recentlyExpired: "最近过期",
    cardRecommendations: "信用卡推荐",
    noMatchingOffers: "没有匹配的有效 offer.",
    noMatchingOffersFound: "没有找到匹配的 offer.",
    noCardMatch: "没有匹配到卡片基础福利。优先使用上面的有效 offer，否则用日常默认卡。",
    noCardBenefitMatch: "没有匹配到卡片基础福利。优先使用上面的有效 offer，或者使用日常默认卡。",
    activate: "需激活",
    activated: "已激活",
    needsActivation: "需激活",
    activateOffer: "激活",
    expiresShort: "到期",
    verified: "已核实",
    reviewed: "已复核",
    verify: "需核实",
    needsVerification: "需核实",
    note: "备注",
    addOn: "附加",
    walletStrategy: "钱包策略",
    watchlistMatch: "关注列表匹配",
    bestAvailable: "根据有效 offer 和卡片基础福利选择的最佳匹配。",
    ccmRoute: "CCM",
    noPortalCheck: "这个问题没有购物返现入口建议。",
  },
};

export function resolveLanguage(options = {}) {
  const raw = String(options.lang || options.language || "auto").trim().toLowerCase();
  if (SUPPORTED_LANGUAGES.has(raw)) return raw;
  return detectLanguage(options.query || options.text || "");
}

export function detectLanguage(text) {
  return /[\u3400-\u9fff]/.test(String(text || "")) ? "zh" : "en";
}

export function t(lang, key) {
  const language = SUPPORTED_LANGUAGES.has(lang) ? lang : "en";
  return LABELS[language][key] || LABELS.en[key] || key;
}

export function languageChoices() {
  return [
    { name: "Auto", value: "auto" },
    { name: "English", value: "en" },
    { name: "中文", value: "zh" },
  ];
}
