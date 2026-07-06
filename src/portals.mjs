const DEFAULT_RAKUTEN_TEMPLATE = "https://www.rakuten.com/{domain}";
const RAKUTEN_STORE_SLUGS = new Map([
  ["macys", "macys"],
  ["macy's", "macys"],
  ["macy", "macys"],
  ["nike", "nike"],
  ["nike.com", "nike"],
  ["lululemon", "lululemon"],
  ["lululemon.com", "lululemon"],
  ["lululemom", "lululemon"],
  ["visible", "visible"],
  ["visible.com", "visible"],
  ["visiblebyverizon", "visible"],
]);
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
      url: intent.merchant ? buildRakutenUrl(query, env) : buildRakutenHomeUrl(env),
      reason: intent.merchant
        ? "Open the merchant's Rakuten store page before clicking through."
        : "Open Rakuten and verify the current cash back rate before buying.",
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
  const direct = directRakutenStoreUrl(query);
  if (direct) return direct;

  const template = String(env.RAKUTEN_SEARCH_URL_TEMPLATE || DEFAULT_RAKUTEN_TEMPLATE);
  const domain = merchantDomainCandidate(query);
  return template.includes("{query}")
    ? template.replaceAll("{query}", encodeURIComponent(query))
    : template.includes("{domain}")
    ? template.replaceAll("{domain}", encodeURIComponent(domain))
    : `${template}${encodeURIComponent(query)}`;
}

function buildRakutenHomeUrl(env = process.env) {
  return String(env.RAKUTEN_HOME_URL || "https://www.rakuten.com/");
}

function directRakutenStoreUrl(query) {
  const slug = RAKUTEN_STORE_SLUGS.get(normalizeMerchantKey(query));
  return slug ? `https://www.rakuten.com/shop/${slug}` : null;
}

function merchantDomainCandidate(query) {
  const cleaned = String(query || "").trim().toLowerCase();
  if (/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(cleaned)) return cleaned;
  return `${normalizeMerchantKey(query)}.com`;
}

function normalizeMerchantKey(query) {
  return String(query || "")
    .trim()
    .toLowerCase()
    .replace(/[’‘`´]/g, "'")
    .replace(/^www\./, "")
    .replace(/[^a-z0-9.']+/g, "")
    .replace(/\.com$/, "");
}
