import { getOllamaConfig } from "./config.mjs";
import { canonicalizeCategory, canonicalizeMerchant, classifyQuery, normalizeText } from "./canonical.mjs";

const CATEGORY_KEYWORDS = [
  ["dining", ["restaurant", "dining", "dinner", "lunch", "brunch", "supper", "餐厅", "吃饭", "晚饭", "午饭", "外卖", "咖啡", "奶茶", "takeout", "delivery"]],
  ["hotel", ["hotel", "酒店", "hyatt", "marriott", "hilton", "resort", "住宿"]],
  ["airfare", ["flight", "airline", "机票", "航班", "delta", "united", "american airlines", "aa"]],
  ["travel", ["travel", "旅行", "旅游", "租车", "rental car", "uber", "lyft", "turo"]],
  ["grocery", ["grocery", "超市", "买菜", "supermarket"]],
  ["gas", ["gas", "加油", "fuel", "charging", "ev"]],
  ["drugstore", ["drugstore", "药店", "cvs", "walgreens", "pharmacy"]],
  ["department_store", ["department store", "百货", "百货店", "商场", "macy", "macys", "macy's"]],
  ["clothing", ["clothing", "clothes", "apparel", "衣服", "服装", "鞋", "西装"]],
  ["general_shopping", ["shopping", "买", "购物", "retail", "store"]],
  ["streaming", ["streaming", "netflix", "spotify", "hulu", "subscription"]],
];

const ALLOWED_CATEGORIES = new Set(CATEGORY_KEYWORDS.map(([category]) => category));
const ALLOWED_INTENTS = new Set(["purchase_advice", "offer_search", "card_recommendation"]);
const GENERIC_MERCHANTS = new Set([
  ...ALLOWED_CATEGORIES,
  "dining",
  "restaurant",
  "restaurants",
  "hotel",
  "hotels",
  "store",
  "shop",
  "shopping",
  "餐厅",
  "饭店",
  "吃饭",
  "晚饭",
  "午饭",
  "周末吃饭",
]);

const KNOWN_MERCHANTS = [
  "hyatt",
  "marriott",
  "delta",
  "united",
  "american airlines",
  "expedia",
  "hotels.com",
  "turo",
  "lyft",
  "uber",
  "ray-ban",
  "raymour",
  "popeyes",
  "resy",
  "peets",
  "cvs",
  "walgreens",
  "walmart",
  "shell",
  "bp",
];

export async function parseIntent(query, options = {}) {
  const fallback = fallbackIntent(query);
  if (options.disableLlm || process.env.OFFER_DISABLE_LLM === "1") return fallback;

  try {
    const parsed = await parseIntentWithOllama(query, options);
    return mergeIntent(fallback, parsed);
  } catch (error) {
    return {
      ...fallback,
      parser: "fallback",
      parserError: error.message,
    };
  }
}

export function fallbackIntent(query) {
  const normalized = normalizeText(query);
  const amount = parseAmount(query);
  const merchant = findMerchant(normalized);
  const category = findCategory(normalized, merchant);

  return {
    rawQuery: query,
    merchant,
    category,
    intent: "purchase_advice",
    amount,
    wantsOffers: true,
    wantsCardRecommendation: true,
    offerSearchQuery: buildOfferSearchQuery({ merchant, category, rawQuery: query }),
    recommendationQuery: buildRecommendationQuery({ merchant, category, rawQuery: query }),
    parser: "fallback",
  };
}

export function intentToSearchQuery(intent) {
  return buildOfferSearchQuery(intent);
}

async function parseIntentWithOllama(query, options = {}) {
  const config = { ...getOllamaConfig(), ...options.ollama };
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.timeoutMs);

  try {
    const response = await fetch(`${config.url.replace(/\/$/, "")}/api/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: config.model,
        stream: false,
        format: "json",
        options: {
          temperature: 0,
          num_predict: 180,
        },
        messages: [
          {
            role: "system",
            content: [
              "You parse credit-card purchase questions into JSON only.",
              "Do not explain. Do not include markdown.",
              "Schema:",
              "{",
              '  "merchant": string|null,',
              '  "category": "dining"|"restaurant"|"hotel"|"airfare"|"travel"|"grocery"|"gas"|"drugstore"|"department_store"|"clothing"|"general_shopping"|"shopping"|"streaming"|null,',
              '  "intent": "purchase_advice"|"offer_search"|"card_recommendation",',
              '  "amount": number|null,',
              '  "wants_offers": boolean,',
              '  "wants_card_recommendation": boolean',
              "}",
            ].join("\n"),
          },
          {
            role: "user",
            content: String(query),
          },
        ],
      }),
      signal: controller.signal,
    });

    if (!response.ok) throw new Error(`Ollama HTTP ${response.status}`);
    const payload = await response.json();
    return normalizeLlmIntent(JSON.parse(extractJson(payload.message?.content || "")));
  } finally {
    clearTimeout(timeout);
  }
}

function normalizeLlmIntent(intent) {
  const category = canonicalizeCategory(intent.category) || cleanString(intent.category);
  const normalizedIntent = cleanString(intent.intent);
  const merchant = cleanMerchant(intent.merchant);

  return {
    merchant,
    category: ALLOWED_CATEGORIES.has(category) ? category : canonicalizeCategory(category),
    intent: ALLOWED_INTENTS.has(normalizedIntent) ? normalizedIntent : "purchase_advice",
    amount: Number.isFinite(Number(intent.amount)) ? Number(intent.amount) : null,
    wantsOffers: Boolean(intent.wants_offers ?? intent.wantsOffers ?? true),
    wantsCardRecommendation: Boolean(
      intent.wants_card_recommendation ?? intent.wantsCardRecommendation ?? true,
    ),
    parser: "ollama",
  };
}

function mergeIntent(fallback, parsed) {
  const category = mergeCategory(fallback.category, parsed.category);
  const merged = {
    ...fallback,
    ...parsed,
    merchant: fallback.merchant || parsed.merchant,
    category,
    amount: parsed.amount ?? fallback.amount,
    wantsOffers: parsed.wantsOffers || fallback.wantsOffers,
    wantsCardRecommendation: parsed.wantsCardRecommendation || fallback.wantsCardRecommendation,
    parser: parsed.parser || fallback.parser,
  };
  return {
    ...merged,
    offerSearchQuery: buildOfferSearchQuery(merged),
    recommendationQuery: buildRecommendationQuery(merged),
  };
}

export function mergeCategory(fallbackCategory, parsedCategory) {
  if (!fallbackCategory) return parsedCategory || null;
  if (!parsedCategory) return fallbackCategory;
  if (fallbackCategory === parsedCategory) return fallbackCategory;
  if (fallbackCategory !== "general_shopping") return fallbackCategory;
  return parsedCategory;
}

function buildOfferSearchQuery(intent) {
  if (intent.merchant) return String(intent.merchant).trim();
  if (intent.category) return String(intent.category).trim();
  return String(intent.rawQuery || "").trim();
}

function buildRecommendationQuery(intent) {
  return [intent.merchant, intent.category, intent.rawQuery]
    .map((value) => String(value || "").trim())
    .filter(Boolean)
    .join(" ") || String(intent.rawQuery || "").trim();
}

function findMerchant(normalizedQuery) {
  const classified = classifyQuery(normalizedQuery);
  if (classified.canonicalMerchant) return classified.canonicalMerchant;
  return KNOWN_MERCHANTS.find((merchant) => normalizedQuery.includes(merchant)) || null;
}

function findCategory(normalizedQuery, merchant) {
  const classified = classifyQuery(normalizedQuery);
  if (classified.canonicalCategory) return classified.canonicalCategory;

  for (const [category, keywords] of CATEGORY_KEYWORDS) {
    if (keywords.some((keyword) => normalizedQuery.includes(keyword))) return category;
  }
  if (merchant === "hyatt" || merchant === "marriott") return "hotel";
  if (merchant === "delta" || merchant === "united" || merchant === "american airlines") {
    return "airfare";
  }
  return null;
}

function parseAmount(query) {
  const match = String(query || "").match(/\$?\s*([0-9][0-9,]*(?:\.[0-9]+)?)/);
  return match ? Number(match[1].replaceAll(",", "")) : null;
}

function extractJson(text) {
  const trimmed = String(text || "").trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced) return fenced[1].trim();
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start !== -1 && end !== -1 && end > start) return trimmed.slice(start, end + 1);
  return trimmed;
}

function cleanString(value) {
  if (value == null) return null;
  const cleaned = String(value).trim();
  return cleaned || null;
}

function cleanMerchant(value) {
  const cleaned = cleanString(value);
  if (!cleaned) return null;

  const normalized = normalizeText(cleaned);
  if (GENERIC_MERCHANTS.has(normalized)) return null;
  if (canonicalizeCategory(cleaned)) return null;

  const merchant = canonicalizeMerchant(cleaned);
  return merchant.confidence >= 0.9 ? merchant.canonicalMerchant : cleaned;
}
