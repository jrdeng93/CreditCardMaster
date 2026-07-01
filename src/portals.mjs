const DEFAULT_RAKUTEN_TEMPLATE = "https://www.rakuten.com/stores/all?query={query}";
const PORTAL_CATEGORIES = new Set([
  "department_store",
  "clothing",
  "electronics",
  "home_improvement",
  "general_shopping",
  "hotel",
  "travel",
  "entertainment",
  "streaming",
]);
const LOW_VALUE_CATEGORIES = new Set(["dining", "grocery", "gas", "drugstore", "airfare", "financial", "fitness"]);

export function buildPortalChecks(intent = {}, options = {}) {
  const env = options.env || process.env;
  if (String(env.RAKUTEN_ENABLED || "1") === "0") return [];

  const query = portalQuery(intent);
  if (!query) return [];
  if (!shouldSuggestPortal(intent)) return [];

  return [
    {
      provider: "Rakuten",
      label: "Rakuten",
      query,
      url: buildRakutenUrl(query, env),
      reason: intent.merchant
        ? "Check shopping portal cash back before clicking through."
        : "Check shopping portal cash back for this category before buying.",
    },
  ];
}

export function formatPortalCheck(check, lang = "en") {
  if (lang === "zh") {
    return `检查 ${check.label} 返现入口: ${check.url}`;
  }
  return `Check ${check.label} cash back: ${check.url}`;
}

function portalQuery(intent = {}) {
  return String(intent.merchant || intent.category || intent.offerSearchQuery || intent.rawQuery || "").trim();
}

function shouldSuggestPortal(intent = {}) {
  if (intent.merchant) return true;
  const category = String(intent.category || "").trim();
  if (!category) return false;
  if (LOW_VALUE_CATEGORIES.has(category)) return false;
  return PORTAL_CATEGORIES.has(category);
}

function buildRakutenUrl(query, env = process.env) {
  const template = String(env.RAKUTEN_SEARCH_URL_TEMPLATE || DEFAULT_RAKUTEN_TEMPLATE);
  return template.includes("{query}")
    ? template.replaceAll("{query}", encodeURIComponent(query))
    : `${template}${encodeURIComponent(query)}`;
}
