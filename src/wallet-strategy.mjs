import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { getDistributionMode, PUBLIC_DISTRIBUTION } from "./distribution.mjs";

const STRATEGY_PATH = join(process.cwd(), "data", "wallet-strategy.json");
const PUBLIC_STRATEGY_PATH = join(process.cwd(), "data", "wallet-strategy.public.json");
const DEFAULT_POINT_VALUE_CENTS = 1;

export function loadWalletStrategy(path = defaultStrategyPath()) {
  try {
    return normalizeStrategy(JSON.parse(readFileSync(path, "utf8")));
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    return normalizeStrategy({});
  }
}

function defaultStrategyPath() {
  if (getDistributionMode() === PUBLIC_DISTRIBUTION && existsSync(PUBLIC_STRATEGY_PATH)) {
    return PUBLIC_STRATEGY_PATH;
  }
  return STRATEGY_PATH;
}

export function applyWalletStrategyToCandidate(candidate, context = {}) {
  if (!candidate || candidate.type !== "base_card") return candidate;

  const strategy = normalizeStrategy(context.strategy);
  const intent = context.intent || {};
  const card = candidate.card;
  const rule = candidate.rule || {};
  const key = cardKey(card);
  const adjustments = [];
  let score = candidate.score;

  const rewardCurrency = inferRewardCurrency(card, rule);
  const pointValue = strategy.pointsValueCents[rewardCurrency] ?? DEFAULT_POINT_VALUE_CENTS;
  const pointAdjustment = Math.round((pointValue - DEFAULT_POINT_VALUE_CENTS) * 8);
  if (pointAdjustment) {
    score += pointAdjustment;
    adjustments.push(`${rewardCurrency.toUpperCase()} valued at ${pointValue} cpp`);
  }

  const priority = strategy.cardPriority[key];
  if (priority === "preferred") {
    score += 8;
    adjustments.push("preferred card in wallet strategy");
  } else if (priority === "benefits_only" && !isStrongMerchantOrPortalMatch(card, rule, intent)) {
    score -= 18;
    adjustments.push("benefits-only card; avoid for ordinary spend");
  } else if (priority === "avoid_unless_merchant" && !isMerchantMatch(card, intent)) {
    score -= 25;
    adjustments.push("avoid unless merchant-specific");
  }

  const reservedCategory = strategy.monthlyCategoryStrategy[key];
  if (reservedCategory && intent.category && reservedCategory !== intent.category) {
    score -= 35;
    adjustments.push(`reserved for ${reservedCategory} this cycle`);
  }

  return {
    ...candidate,
    score,
    walletAdjustments: adjustments,
    rewardCurrency,
    pointValueCents: pointValue,
    reason: candidate.reason,
  };
}

export function applyWalletStrategyToRecommendation(recommendation, context = {}) {
  const rule = recommendation.matchedRules?.[0];
  if (!rule) return recommendation;
  const confidenceAdjustment = recommendation.card.verified ? 3 : -5;
  const candidate = applyWalletStrategyToCandidate({
    type: "base_card",
    card: recommendation.card,
    rule,
    score: (recommendation.score || 0) * 10 + confidenceAdjustment,
    reason: null,
  }, context);
  return {
    ...recommendation,
    adjustedScore: candidate.score,
    walletAdjustments: candidate.walletAdjustments || [],
    rewardCurrency: candidate.rewardCurrency,
    pointValueCents: candidate.pointValueCents,
  };
}

export function applyWalletStrategyToRecommendations(recommendations, context = {}) {
  return (recommendations || [])
    .map((recommendation) => applyWalletStrategyToRecommendation(recommendation, context))
    .sort((a, b) => (b.adjustedScore ?? b.score) - (a.adjustedScore ?? a.score));
}

export function cardKey(card) {
  return `${card.issuer}:${card.cardName}:${card.cardLast4}`;
}

export function normalizeStrategy(strategy = {}) {
  return {
    pointsValueCents: {
      cash: DEFAULT_POINT_VALUE_CENTS,
      ...(strategy.pointsValueCents || {}),
    },
    cardPriority: strategy.cardPriority || {},
    monthlyCategoryStrategy: strategy.monthlyCategoryStrategy || {},
    defaultFallbackCard: strategy.defaultFallbackCard || null,
    categoryFallbackCards: strategy.categoryFallbackCards || {},
  };
}

export function formatWalletStrategy(strategy = loadWalletStrategy()) {
  const normalized = normalizeStrategy(strategy);
  return [
    "Wallet strategy",
    "",
    "Point values:",
    ...Object.entries(normalized.pointsValueCents)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([currency, value]) => `- ${currency.toUpperCase()}: ${value} cpp`),
    "",
    "Card priority:",
    ...formatEntries(normalized.cardPriority),
    "",
    "Monthly category strategy:",
    ...formatEntries(normalized.monthlyCategoryStrategy),
    "",
    "Fallback cards:",
    `- default: ${normalized.defaultFallbackCard || "none"}`,
    ...Object.entries(normalized.categoryFallbackCards)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([category, key]) => `- ${category}: ${key}`),
  ].join("\n");
}

function formatEntries(object) {
  const entries = Object.entries(object || {});
  if (!entries.length) return ["- none"];
  return entries.sort(([a], [b]) => a.localeCompare(b)).map(([key, value]) => `- ${key}: ${value}`);
}

function inferRewardCurrency(card, rule) {
  const text = `${card.issuer || ""} ${card.cardName || ""} ${rule.summary || ""}`.toLowerCase();
  if (text.includes("ultimate rewards")) return "ur";
  if (text.includes("membership rewards")) return "mr";
  if (text.includes("thankyou")) return "typ";
  if (text.includes("hyatt")) return "hyatt";
  if (text.includes("marriott")) return "marriott";
  if (text.includes("delta") || text.includes("skymiles")) return "delta";
  return "cash";
}

function isStrongMerchantOrPortalMatch(card, rule, intent) {
  const category = String(rule.category || "");
  return (
    isMerchantMatch(card, intent) ||
    category.includes("portal") ||
    ["airfare", "hotel", "lounge"].includes(category)
  );
}

function isMerchantMatch(card, intent) {
  if (!intent.merchant) return false;
  const merchant = String(intent.merchant).toLowerCase();
  return (card.aliases || []).some((alias) => merchant.includes(String(alias).toLowerCase()));
}
