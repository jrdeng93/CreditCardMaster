import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { canonicalizeCategory, classifyQuery, normalizeText } from "./canonical.mjs";
import { parseIntent } from "./intent.mjs";
import { expandTerms, formatOffers, queryTokens, searchExpiredOffers, searchOffers } from "./search.mjs";
import { buildDecision } from "./decision.mjs";
import { findWatchlistMatches } from "./watchlist.mjs";
import { applyWalletStrategyToRecommendations, loadWalletStrategy } from "./wallet-strategy.mjs";
import { resolveLanguage, t } from "./i18n.mjs";
import { getDistributionMode, PUBLIC_DISTRIBUTION } from "./distribution.mjs";
import { buildPortalChecks, formatPortalCheck } from "./portals.mjs";

const BENEFITS_PATH = join(process.cwd(), "data", "card-benefits.json");
const PUBLIC_BENEFITS_PATH = join(process.cwd(), "data", "card-benefits.public.json");

export function loadCardBenefits(path = defaultBenefitsPath()) {
  const payload = JSON.parse(readFileSync(path, "utf8"));
  const byKey = new Map();
  const cards = payload.cards.map((card) => ({ ...card }));

  for (const card of cards) {
    byKey.set(cardKey(card), card);
  }

  for (const card of cards) {
    if (!card.copyBenefitsFrom) continue;
    const source = byKey.get(card.copyBenefitsFrom);
    if (!source) continue;
    card.bestFor = source.bestFor;
    card.rules = source.rules;
    card.notes = source.notes;
    card.sourceUrl = source.sourceUrl;
    card.verified = source.verified;
    card.lastVerifiedAt = source.lastVerifiedAt;
    card.verificationNote = source.verificationNote;
  }

  return { updatedAt: payload.updatedAt, cards };
}

export function recommendCards(query, options = {}) {
  const limit = options.limit ?? 5;
  const context = buildBenefitQueryContext(query);
  const benefitData = options.benefitData || loadCardBenefits();

  return benefitData.cards
    .map((card) => {
      const matchedRules = matchRules(card, context);
      const aliasScore = matchAliases(card, context);
      const score = matchedRules.reduce((sum, rule) => sum + rule.score, 0) + aliasScore;
      return { card, matchedRules, score };
    })
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score || cardLabel(a.card).localeCompare(cardLabel(b.card)))
    .slice(0, limit);
}

export function searchWithRecommendations(db, query, options = {}) {
  const intent = options.intent || {
    rawQuery: query,
    offerSearchQuery: query,
    recommendationQuery: query,
    parser: "raw",
  };
  const offerSearchQuery = intent.offerSearchQuery || query;
  const recommendationQuery = intent.recommendationQuery || offerSearchQuery;
  const requiredTerms = intent.merchant ? queryTokens(intent.merchant) : [];
  const offers = searchOffers(db, offerSearchQuery, {
    limit: options.offerLimit ?? 8,
    requiredTerms,
  });
  const expiredOffers = offers.length
    ? []
    : searchExpiredOffers(db, offerSearchQuery, {
      limit: options.expiredOfferLimit ?? 3,
      requiredTerms,
  });
  const walletStrategy = options.walletStrategy || loadWalletStrategy();
  const recommendationLimit = options.recommendationLimit ?? 5;
  const recommendationCandidateLimit = options.recommendationCandidateLimit ?? Math.max(12, recommendationLimit * 4);
  const recommendations = applyWalletStrategyToRecommendations(
    recommendCards(recommendationQuery, { limit: recommendationCandidateLimit }),
    { intent, strategy: walletStrategy },
  );
  const finalRecommendations = recommendations.length
    ? recommendations
    : applyWalletStrategyToRecommendations(
      recommendFallbackCards({
        limit: recommendationLimit,
        strategy: walletStrategy,
        intent,
      }),
      { intent, strategy: walletStrategy },
    );
  const conditionalBenefitTips = findConditionalBenefitTips(recommendationQuery, {
    limit: options.conditionalBenefitLimit ?? 2,
  });
  const watchlistMatches = findWatchlistMatches(db, intent);
  const portalChecks = buildPortalChecks(intent, options);
  const result = { intent, offers, expiredOffers, recommendations: finalRecommendations, conditionalBenefitTips, watchlistMatches, walletStrategy, portalChecks };
  return { ...result, decision: buildDecision(result) };
}

export async function askWithRecommendations(db, query, options = {}) {
  const intent = await parseIntent(query, options);
  return searchWithRecommendations(db, query, { ...options, intent });
}

export function formatSearchWithRecommendations(result, options = {}) {
  const lang = resolveLanguage({
    lang: options.lang || options.language,
    query: result.intent?.rawQuery || result.intent?.recommendationQuery || result.intent?.offerSearchQuery,
  });
  if (options.verbose) return formatVerboseSearchWithRecommendations(result, { ...options, lang });
  return formatCompactSearchWithRecommendations(result, options);
}

export function formatVerboseSearchWithRecommendations(result, options = {}) {
  const lang = resolveLanguage({
    lang: options.lang || options.language,
    query: result.intent?.rawQuery || result.intent?.recommendationQuery || result.intent?.offerSearchQuery,
  });
  const sections = [];

  if (result.intent) {
    sections.push(formatIntent(result.intent));
    sections.push("");
  }

  sections.push(t(lang, "offers"));
  sections.push(formatOffers(result.offers, { lang }));

  if (result.expiredOffers?.length) {
    sections.push("");
    sections.push(t(lang, "recentlyExpired"));
    sections.push(formatOffers(result.expiredOffers, { lang }));
  }

  sections.push("");
  sections.push(t(lang, "cardRecommendations"));
  sections.push(formatRecommendations(result.recommendations, { lang }));

  return sections.join("\n");
}

export function formatCompactSearchWithRecommendations(result, options = {}) {
  const lang = resolveLanguage({
    lang: options.lang || options.language,
    query: result.intent?.rawQuery || result.intent?.recommendationQuery || result.intent?.offerSearchQuery,
  });
  const offerLimit = options.offerLimit ?? 5;
  const recommendationLimit = options.recommendationLimit ?? 5;
  const sections = [];

  if (result.intent) {
    const intentParts = [
      result.intent.merchant || result.intent.category,
      result.intent.amount ? `$${result.intent.amount}` : null,
    ].filter(Boolean);
    if (intentParts.length) sections.push(`${t(lang, "recognized")}: ${intentParts.join(" / ")}`);
  }

  if (result.decision) {
    sections.push(formatActionDecision(result, lang));
  }

  if (options.showOffers !== false) {
    const displayedOffers = offersForCompactDisplay(result, offerLimit);
    sections.push("");
    sections.push(`${t(lang, displayedOffers.selectedOnly ? "relevantOffers" : "relatedOffers")}:`);
    sections.push(formatCompactOffers(displayedOffers.rows, lang));
  }

  const alternatives = alternativeRecommendations(result).slice(0, recommendationLimit);
  if (alternatives.length) {
    sections.push("");
    sections.push(`${t(lang, "alternatives")}:`);
    sections.push(formatCompactRecommendations(
      alternatives,
      result.conditionalBenefitTips || [],
      lang,
    ));
  }

  return sections.join("\n");
}

export function formatIntent(intent) {
  const parts = [
    intent.merchant ? `merchant=${intent.merchant}` : null,
    intent.category ? `category=${intent.category}` : null,
    intent.amount ? `amount=$${intent.amount}` : null,
    intent.parser ? `parser=${intent.parser}` : null,
  ].filter(Boolean);
  return `Intent: ${parts.join(" | ") || "raw query"}`;
}

export function formatRecommendations(items, options = {}) {
  const lang = resolveLanguage(options);
  if (!items.length) {
    return t(lang, "noCardBenefitMatch");
  }

  return items
    .map((item, index) => {
      const topRules = item.matchedRules.slice(0, 2);
      const confidence = reviewStatus(item.card, lang);
      const reasons = topRules.map((rule) => `- ${rule.summary}`).join("\n");
      const notes = (item.card.notes || []).slice(0, 1).map((note) => `- ${t(lang, "note")}: ${note}`).join("\n");
      return [
        `${index + 1}. ${cardLabel(item.card)} (${confidence})`,
        reasons,
        notes,
      ].filter(Boolean).join("\n");
    })
    .join("\n\n");
}

export function formatCompactRecommendations(items, conditionalBenefitTips = [], lang = "en") {
  if (!items.length) return t(lang, "noCardMatch");

  return items
    .map((item, index) => {
      const rule = item.matchedRules[0];
      const confidence = item.card.lastVerifiedAt ? ` [${t(lang, "reviewed")} ${item.card.lastVerifiedAt}]` : ` [${t(lang, "verify")}]`;
      const wallet = item.walletAdjustments?.length ? ` [${item.walletAdjustments.join("; ")}]` : "";
      const addOn = formatConditionalBenefitAddOn(item, conditionalBenefitTips, lang);
      return `${index + 1}. ${cardLabel(item.card)}${confidence} - ${rule?.summary || "benefit match"}${wallet}${addOn}`;
    })
    .join("\n");
}

function formatCompactOffers(rows, lang = "en") {
  if (rows.length === 0) return t(lang, "noMatchingOffers");

  return rows
    .map((row) => {
      const card = row.card_last4 ? `****${row.card_last4}` : row.card_name || "";
      const issuerCard = [title(row.issuer), card].filter(Boolean).join(" ");
      const flags = [
        row.activation_required && !row.activated ? t(lang, "activate") : null,
        row.expires_on ? `${t(lang, "expiresShort")} ${row.expires_on}` : null,
      ].filter(Boolean);
      return `- ${issuerCard}: ${row.merchant} - ${row.reward_text}${flags.length ? ` (${flags.join(", ")})` : ""}`;
    })
    .join("\n");
}

function formatActionDecision(result, lang = "en") {
  const decision = result.decision;
  const beforePaying = beforePayingItems(result, lang);
  return [
    `${t(lang, "use")}:`,
    `${decision.label} - ${decision.summary}`,
    "",
    `${t(lang, "reasoning")}:`,
    `- ${localizeDecisionReason(decision.reason, lang) || t(lang, "bestAvailable")}`,
    ...(decision.walletAdjustments || []).map((item) => `- ${t(lang, "walletStrategy")}: ${item}`),
    result.watchlistMatches?.length ? `- ${t(lang, "watchlistMatch")}: ${formatWatchMatches(result.watchlistMatches)}` : null,
    beforePaying.length ? "" : null,
    beforePaying.length ? `${t(lang, "beforePaying")}:` : null,
    ...beforePaying.map((item) => `- ${item}`),
  ].filter(Boolean).join("\n");
}

function beforePayingItems(result, lang = "en") {
  const items = [];
  const selectedOffer = result.decision?.type === "offer" ? result.decision.row : null;
  if (selectedOffer?.activation_required && !selectedOffer.activated) {
    const issuerCard = [title(selectedOffer.issuer), selectedOffer.card_last4 ? `****${selectedOffer.card_last4}` : ""].filter(Boolean).join(" ");
    items.push(`${t(lang, "activateOffer")} ${issuerCard} offer: ${selectedOffer.merchant}`);
  }
  for (const check of result.portalChecks || []) {
    items.push(formatPortalCheck(check, lang));
  }
  return items;
}

function formatWatchMatches(rows) {
  return rows.map((row) => row.value).slice(0, 3).join(", ");
}

function formatConditionalBenefitAddOn(item, conditionalBenefitTips, lang = "en") {
  const addOn = conditionalBenefitTips.find((tip) =>
    tip.card.issuer === item.card.issuer &&
    tip.card.cardName === item.card.cardName &&
    tip.card.cardLast4 === item.card.cardLast4
  );
  if (!addOn) return "";

  return ` [${t(lang, "addOn")}: ${compactConditionalBenefitSummary(addOn.rule)}]`;
}

function localizeDecisionReason(reason, lang) {
  if (!reason || lang !== "zh") return reason;
  if (/Offer match; activate first/i.test(reason)) return reason.replace(/Offer match; activate first/i, "匹配到 offer；需先激活");
  if (/Offer match beats normal base earning/i.test(reason)) return "匹配到有效 offer，优先于普通卡片基础返利。";
  if (/Base card benefit match, but verify current terms/i.test(reason)) return "匹配到卡片基础福利，但使用前需要核实当前条款。";
  if (/Base card benefit match/i.test(reason)) return "匹配到卡片基础福利。";
  if (/No matching offer found; use this fallback card/i.test(reason)) return "没有匹配到有效 offer；建议使用这张日常兜底卡。";
  if (/Use your normal fallback card/i.test(reason)) return "使用日常默认卡；如果这是定向 offer，可以手动添加。";
  return reason;
}

function compactConditionalBenefitSummary(rule) {
  const summary = String(rule.summary || "conditional benefit");
  if (/citi nights/i.test(summary) && /\b6x\b/i.test(summary)) {
    return "Citi Nights 6X on Fri/Sat nights, roughly 6 p.m.-6 a.m.; verify terms";
  }
  const conditions = (rule.requiresAny || []).slice(0, 3).join("/");
  return conditions ? `${summary} Conditions: ${conditions}` : summary;
}

function reviewStatus(card, lang = "en") {
  if (card.lastVerifiedAt) return `${t(lang, "reviewed")} ${card.lastVerifiedAt}`;
  return card.verified ? t(lang, "verified") : t(lang, "needsVerification");
}

function alternativeRecommendations(result) {
  if (result.decision?.type !== "base_card") return result.recommendations || [];
  const selected = result.decision.card;
  return (result.recommendations || []).filter((item) =>
    item.card.issuer !== selected.issuer ||
    item.card.cardName !== selected.cardName ||
    item.card.cardLast4 !== selected.cardLast4,
  );
}

function buildBenefitQueryContext(query) {
  const profile = classifyQuery(query);
  const terms = expandTerms(query);
  const normalizedQuery = normalizeText(query);
  return {
    query,
    profile,
    terms,
    normalizedQuery,
    canonicalCategory: profile.canonicalCategory,
    canonicalMerchant: profile.canonicalMerchant,
  };
}

function matchRules(card, context) {
  return (card.rules || [])
    .filter((rule) => !isFallbackRule(rule))
    .map((rule) => {
      if (!ruleRequirementsMatched(rule, context)) return null;

      if (ruleMatchesCategory(rule, context)) return withCanonicalCategory(rule);
      if (ruleMatchesKeyword(rule, context)) return withCanonicalCategory(rule);
      return null;
    })
    .filter(Boolean)
    .sort((a, b) => b.score - a.score);
}

function findConditionalBenefitTips(query, options = {}) {
  const limit = options.limit ?? 2;
  const context = buildBenefitQueryContext(query);
  const benefitData = options.benefitData || loadCardBenefits();

  return benefitData.cards
    .flatMap((card) => (card.rules || [])
      .filter((rule) => rule.requiresAny?.length)
      .filter((rule) => !ruleRequirementsMatched(rule, context))
      .filter((rule) => ruleMatchesCategory(rule, context) || ruleMatchesKeyword(rule, context))
      .map((rule) => ({ card, rule: withCanonicalCategory(rule) })))
    .sort((a, b) => (b.rule.score || 0) - (a.rule.score || 0) || cardLabel(a.card).localeCompare(cardLabel(b.card)))
    .slice(0, limit);
}

function recommendFallbackCards(options = {}) {
  const limit = options.limit ?? 3;
  const benefitData = options.benefitData || loadCardBenefits();
  const strategy = options.strategy || {};
  const intent = options.intent || {};
  const preferredKeys = [
    intent.category ? strategy.categoryFallbackCards?.[intent.category] : null,
    strategy.defaultFallbackCard,
  ].filter(Boolean);

  const preferred = [...new Set(preferredKeys)]
    .map((key) => buildFallbackRecommendationForKey(benefitData, key))
    .filter(Boolean);
  const seen = new Set(preferred.map((item) => cardKey(item.card)));

  const catalogFallbacks = benefitData.cards
    .flatMap((card) => (card.rules || [])
      .filter(isFallbackRule)
      .map((rule) => ({
        card,
        matchedRules: [{ ...withCanonicalCategory(rule), fallback: true }],
        score: rule.score || 1,
      })))
    .filter((item) => !seen.has(cardKey(item.card)));

  return [...preferred, ...catalogFallbacks]
    .sort((a, b) => b.score - a.score || cardLabel(a.card).localeCompare(cardLabel(b.card)))
    .slice(0, limit);
}

function buildFallbackRecommendationForKey(benefitData, key) {
  const card = benefitData.cards.find((item) => cardKey(item) === key);
  if (!card) return null;
  const rule = (card.rules || []).find(isFallbackRule) || {
    category: "everyday",
    summary: "Fallback card from wallet strategy.",
    score: 4,
    fallback: true,
  };
  return {
    card,
    matchedRules: [{ ...withCanonicalCategory(rule), fallback: true }],
    score: (rule.score || 1) + 50,
  };
}

function offersForCompactDisplay(result, limit) {
  const offers = result.offers || [];
  if (result.decision?.type === "offer") {
    return { selectedOnly: true, rows: offers.slice(0, limit) };
  }

  if (result.intent?.merchant) {
    return { selectedOnly: true, rows: offers.slice(0, limit) };
  }

  return {
    selectedOnly: false,
    rows: offers.slice(0, Math.min(limit, 3)),
  };
}

function isFallbackRule(rule) {
  const category = String(rule.category || "").toLowerCase();
  return Boolean(rule.fallback || ["everyday", "general_spend", "uncategorized"].includes(category));
}

function ruleRequirementsMatched(rule, context) {
  return !rule.requiresAny || rule.requiresAny.some((keyword) => {
    const normalizedKeyword = normalizeText(keyword);
    return context.terms.includes(normalizedKeyword) || context.normalizedQuery.includes(normalizedKeyword);
  });
}

function ruleMatchesCategory(rule, context) {
  const ruleCategory = canonicalizeCategory(rule.category);
  return Boolean(ruleCategory && context.canonicalCategory && ruleCategory === context.canonicalCategory);
}

function ruleMatchesKeyword(rule, context) {
  return (rule.keywords || []).some((keyword) => {
    const normalizedKeyword = normalizeText(keyword);
    const keywordCategory = canonicalizeCategory(keyword);
    return (
      context.terms.includes(normalizedKeyword) ||
      context.normalizedQuery.includes(normalizedKeyword) ||
      Boolean(keywordCategory && context.canonicalCategory && keywordCategory === context.canonicalCategory)
    );
  });
}

function withCanonicalCategory(rule) {
  return {
    ...rule,
    canonicalCategory: canonicalizeCategory(rule.category) || null,
  };
}

function matchAliases(card, context) {
  let score = 0;
  for (const alias of card.aliases || []) {
    const normalizedAlias = normalizeText(alias);
    if (context.terms.includes(normalizedAlias) || context.normalizedQuery.includes(normalizedAlias)) {
      score += 8;
    }
  }
  return score;
}

function cardKey(card) {
  return `${card.issuer}:${card.cardName}:${card.cardLast4}`;
}

function cardLabel(card) {
  const issuer = title(card.issuer);
  const name = String(card.cardName || "");
  const label = name.toLowerCase().startsWith(String(card.issuer).toLowerCase())
    ? name
    : `${issuer} ${name}`;
  return card.cardLast4 ? `${label} ****${card.cardLast4}` : label;
}

function defaultBenefitsPath() {
  if (getDistributionMode() === PUBLIC_DISTRIBUTION && existsSync(PUBLIC_BENEFITS_PATH)) {
    return PUBLIC_BENEFITS_PATH;
  }
  return BENEFITS_PATH;
}

function title(value) {
  return String(value).slice(0, 1).toUpperCase() + String(value).slice(1);
}
