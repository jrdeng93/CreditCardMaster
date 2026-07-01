import { readFileSync } from "node:fs";
import { join } from "node:path";

const TAXONOMY_PATH = join(process.cwd(), "data", "category-taxonomy.json");
const MERCHANTS_PATH = join(process.cwd(), "data", "merchant-aliases.json");

let taxonomyCache;
let merchantCache;

export function normalizeText(input) {
  return String(input || "")
    .normalize("NFKD")
    .replace(/[’‘`´]/g, "'")
    .trim()
    .toLowerCase();
}

export function compactText(input) {
  return normalizeText(input).replace(/[^a-z0-9]+/g, "");
}

export function canonicalizeCategory(value) {
  const taxonomy = loadTaxonomy();
  const normalized = normalizeText(value);
  const compact = compactText(value);
  if (!normalized) return null;

  const legacy = taxonomy.legacyCategoryMap[normalized];
  if (legacy) return legacy;

  for (const category of taxonomy.categories) {
    if (category.id === normalized) return category.id;
    for (const alias of category.aliases || []) {
      const aliasCompact = compactText(alias);
      if (normalizeText(alias) === normalized || (compact && aliasCompact && aliasCompact === compact)) {
        return category.id;
      }
    }
  }

  return null;
}

export function canonicalizeMerchant(value) {
  const normalized = normalizeText(value);
  const compact = compactText(value);
  if (!normalized) return { canonicalMerchant: null, canonicalCategory: null, confidence: 0 };

  for (const merchant of loadMerchants().merchants) {
    for (const alias of merchant.aliases || []) {
      const aliasText = normalizeText(alias);
      const aliasCompact = compactText(alias);
      if (normalized === aliasText || (compact && aliasCompact && compact === aliasCompact)) {
        return {
          canonicalMerchant: merchant.canonical,
          canonicalCategory: merchant.category,
          confidence: 1,
        };
      }
      if (aliasCompact.length >= 4 && compact.includes(aliasCompact)) {
        return {
          canonicalMerchant: merchant.canonical,
          canonicalCategory: merchant.category,
          confidence: 0.9,
        };
      }
    }
  }

  const category = canonicalizeCategory(value);
  if (category) return { canonicalMerchant: null, canonicalCategory: category, confidence: 0 };

  return { canonicalMerchant: value ? String(value).trim() : null, canonicalCategory: null, confidence: 0.4 };
}

export function canonicalizeOffer(offer) {
  const merchant = canonicalizeMerchant(offer.merchant);
  const category =
    merchant.canonicalCategory ||
    canonicalizeCategory(offer.category) ||
    inferCanonicalCategory(offer.merchant, offer.rewardText || offer.reward || offer.sourceText);

  return {
    canonicalMerchant: merchant.canonicalMerchant || String(offer.merchant || "").trim(),
    canonicalCategory: category || "general_shopping",
    categoryConfidence: merchant.canonicalCategory ? merchant.confidence : category ? 0.75 : 0.3,
  };
}

export function classifyQuery(query) {
  const category = canonicalizeCategory(query);
  const merchant = canonicalizeMerchant(query);
  const inferredCategory = category || inferCanonicalCategory(query, "");

  return {
    canonicalMerchant: merchant.confidence >= 0.9 ? merchant.canonicalMerchant : null,
    canonicalCategory: merchant.confidence >= 0.9 ? merchant.canonicalCategory : inferredCategory,
    merchantConfidence: merchant.confidence,
  };
}

export function isKnownCanonicalCategory(value) {
  return Boolean(canonicalizeCategory(value));
}

export function listCanonicalCategoryIds() {
  return loadTaxonomy().categories.map((category) => category.id);
}

function inferCanonicalCategory(merchant = "", rewardText = "") {
  const text = normalizeText(`${merchant} ${rewardText}`);

  if (/\b(restaurant|restaurants|dining|takeout|delivery|coffee|pizza|burger|doordash|resy)\b/.test(text) || /餐厅|吃饭|饭店|咖啡/.test(text)) {
    return "dining";
  }
  if (/\b(hotel|hotels|resort|lodging)\b/.test(text) || /酒店|住宿/.test(text)) return "hotel";
  if (/\b(flight|airline|airfare|airport)\b/.test(text) || /机票|航班/.test(text)) return "airfare";
  if (/\b(travel|cruise|parking|train|airbnb|las vegas|fontainebleau)\b/.test(text) || /旅行|旅游/.test(text)) return "travel";
  if (/\b(grocery|groceries|supermarket|whole foods)\b/.test(text) || /超市|买菜/.test(text)) return "grocery";
  if (/\b(gas|fuel|charging)\b/.test(text) || /加油/.test(text)) return "gas";
  if (/\b(drugstore|pharmacy|cvs|walgreens)\b/.test(text) || /药店/.test(text)) return "drugstore";
  if (/\b(streaming|subscription|netflix|spotify|hulu)\b/.test(text)) return "streaming";
  if (/\b(gym|fitness|pilates)\b/.test(text) || /健身/.test(text)) return "fitness";
  if (/\b(insurance|loan|creditsecure|financial)\b/.test(text) || /保险/.test(text)) return "financial";
  if (/\b(macy's|macys|saks|nordstrom|department store)\b/.test(text) || /百货|商场/.test(text)) return "department_store";
  if (/\b(clothing|clothes|apparel|shoes|sneakers|suit|dress)\b/.test(text) || /衣服|服装|鞋|西装/.test(text)) return "clothing";
  if (/\b(electronics|computer|laptop|phone|appliance)\b/.test(text) || /电器|电脑|手机/.test(text)) return "electronics";
  if (/\b(furniture|hardware|home improvement)\b/.test(text) || /家具|家居|装修/.test(text)) return "home_improvement";
  return null;
}

function loadTaxonomy() {
  if (!taxonomyCache) taxonomyCache = JSON.parse(readFileSync(TAXONOMY_PATH, "utf8"));
  return taxonomyCache;
}

function loadMerchants() {
  if (!merchantCache) merchantCache = JSON.parse(readFileSync(MERCHANTS_PATH, "utf8"));
  return merchantCache;
}
