import { canonicalizeCategory, classifyQuery } from "./canonical.mjs";
import { resolveLanguage, t } from "./i18n.mjs";
import { isIssuerEnabled } from "./distribution.mjs";

const CATEGORY_ALIASES = new Map([
  ["restaurant", ["restaurant", "dining", "meal", "coffee", "delivery", "takeout", "resy"]],
  ["dining", ["restaurant", "dining", "meal", "coffee", "delivery", "takeout", "resy"]],
  ["travel", ["travel", "hotel", "airline", "flight", "rental", "rideshare"]],
  ["grocery", ["grocery", "supermarket", "market"]],
  ["gas", ["gas", "fuel", "charging"]],
  ["shopping", ["shopping", "retail", "store"]],
  ["streaming", ["streaming", "subscription"]],
]);

const STOPWORDS = new Set(["s", "the", "and", "or", "at", "to", "for", "in", "on", "a", "an"]);
const MIN_COMPACT_MATCH_LENGTH = 4;

export function normalizeQuery(input) {
  return normalizeText(input);
}

export function expandTerms(query) {
  const tokens = queryTokens(query);

  const expanded = new Set(tokens);
  for (const token of tokens) {
    const aliases = CATEGORY_ALIASES.get(token);
    if (aliases) aliases.forEach((alias) => expanded.add(alias));
  }
  return [...expanded];
}

export function searchOffers(db, query, options = {}) {
  const limit = options.limit ?? 12;
  const profile = options.queryProfile || classifyQuery(query);
  const terms = expandTerms(query);
  const requiredTerms = (options.requiredTerms || []).flatMap(queryTokens);
  if (terms.length === 0 && !profile.canonicalMerchant && !profile.canonicalCategory) return [];

  const rows = db
    .prepare(
      `SELECT * FROM offers
       WHERE expires_on IS NULL OR date(expires_on) >= date('now', 'localtime')
       ORDER BY activated ASC, expires_on IS NULL ASC, date(expires_on) ASC, merchant ASC`,
    )
    .all();

  return rows
    .filter((row) => isIssuerEnabled(row.issuer))
    .filter((row) => matchesStructuredProfile(row, profile))
    .filter((row) => matchesRequiredTerms(row, requiredTerms))
    .map((row) => ({ row, score: scoreOffer(row, terms, profile) }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score || compareOfferRows(a.row, b.row))
    .slice(0, limit)
    .map((item) => item.row);
}

export function searchExpiredOffers(db, query, options = {}) {
  const limit = options.limit ?? 5;
  const daysBack = options.daysBack ?? 30;
  const profile = options.queryProfile || classifyQuery(query);
  const terms = expandTerms(query);
  const requiredTerms = (options.requiredTerms || []).flatMap(queryTokens);
  if (terms.length === 0 && !profile.canonicalMerchant && !profile.canonicalCategory) return [];

  const rows = db
    .prepare(
      `SELECT * FROM offers
       WHERE expires_on IS NOT NULL
         AND date(expires_on) < date('now', 'localtime')
         AND date(expires_on) >= date('now', 'localtime', @window)
       ORDER BY date(expires_on) DESC, issuer ASC, merchant ASC`,
    )
    .all({ window: `-${Number(daysBack)} days` });

  return rows
    .filter((row) => isIssuerEnabled(row.issuer))
    .filter((row) => matchesStructuredProfile(row, profile))
    .filter((row) => matchesRequiredTerms(row, requiredTerms))
    .map((row) => ({ row, score: scoreOffer(row, terms, profile) }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score || compareOfferRows(a.row, b.row))
    .slice(0, limit)
    .map((item) => item.row);
}

export function queryTokens(input) {
  const normalized = normalizeText(input);
  const tokens = normalized
    .split(/[^a-z0-9]+/i)
    .map((token) => token.trim())
    .filter((token) => token.length > 1 && !STOPWORDS.has(token));

  const compact = compactText(input);
  if (compact.length >= MIN_COMPACT_MATCH_LENGTH && !tokens.includes(compact)) tokens.unshift(compact);
  return tokens;
}

export function expiringOffers(db, days = 14, options = {}) {
  const limit = options.limit ?? 12;
  return db
    .prepare(
      `SELECT * FROM offers
       WHERE expires_on IS NOT NULL
         AND date(expires_on) >= date('now', 'localtime')
         AND date(expires_on) <= date('now', 'localtime', @window)
       ORDER BY date(expires_on) ASC, issuer ASC, merchant ASC
       LIMIT @limit`,
    )
    .all({ window: `+${Number(days)} days`, limit })
    .filter((row) => isIssuerEnabled(row.issuer));
}

export function formatOffers(rows, options = {}) {
  const lang = resolveLanguage(options);
  if (rows.length === 0) return t(lang, "noMatchingOffersFound");

  return rows
    .map((row) => {
      const card = row.card_last4 ? `${row.card_name || row.issuer} ****${row.card_last4}` : row.card_name || row.issuer;
      const flags = [
        row.activated ? "activated" : row.activation_required ? "needs activation" : null,
        row.expires_on ? `expires ${row.expires_on}` : null,
      ].filter(Boolean);

      return [
        `${title(row.issuer)} - ${row.merchant}`,
        `${card}`,
        `${row.reward_text}`,
        `${row.category}${flags.length ? ` | ${flags.join(" | ")}` : ""}`,
      ].join("\n");
    })
    .join("\n\n");
}

function scoreOffer(row, terms, profile = {}) {
  const haystack = offerHaystack(row);
  const compactHaystack = compactOfferHaystack(row);
  const compactMerchant = compactText(row.merchant);
  const merchantTokens = tokenSet(row.merchant);
  const categoryTokens = tokenSet(row.category);
  const haystackTokens = tokenSet(haystack);

  let matchScore = 0;
  if (profile.canonicalMerchant && compactText(rowCanonicalMerchant(row)) === compactText(profile.canonicalMerchant)) {
    matchScore += 40;
  }
  if (profile.canonicalCategory && rowCanonicalCategory(row) === profile.canonicalCategory) {
    matchScore += 25;
  }

  for (const term of terms) {
    if (!term) continue;
    if (merchantTokens.has(term)) matchScore += 10;
    if (term.length >= MIN_COMPACT_MATCH_LENGTH && compactMerchant.includes(term)) matchScore += 12;
    if (term.length >= MIN_COMPACT_MATCH_LENGTH && normalizeText(row.merchant).includes(term)) matchScore += 8;
    if (categoryTokens.has(term)) matchScore += 5;
    if (term.length >= MIN_COMPACT_MATCH_LENGTH && compactHaystack.includes(term)) matchScore += 4;
    if (haystackTokens.has(term)) matchScore += 2;
    if (term.length >= MIN_COMPACT_MATCH_LENGTH && haystack.includes(term)) matchScore += 1;
  }

  if (matchScore === 0) return 0;

  let score = matchScore;
  if (!row.activated && row.activation_required) score += 1;
  if (row.max_reward) score += Math.min(row.max_reward, 50) / 50;
  if (row.reward_value) score += Math.min(row.reward_value, 25) / 25;
  return score;
}

function matchesStructuredProfile(row, profile = {}) {
  if (profile.canonicalMerchant) {
    return compactText(rowCanonicalMerchant(row)) === compactText(profile.canonicalMerchant);
  }

  if (profile.canonicalCategory) {
    return rowCanonicalCategory(row) === profile.canonicalCategory;
  }

  return true;
}

function matchesRequiredTerms(row, requiredTerms) {
  if (!requiredTerms.length) return true;
  const haystack = offerHaystack(row);
  const compactHaystack = compactOfferHaystack(row);
  const tokens = tokenSet(haystack);
  return requiredTerms.every((term) =>
    tokens.has(term) ||
    (term.length >= MIN_COMPACT_MATCH_LENGTH && (haystack.includes(term) || compactHaystack.includes(term))),
  );
}

function offerHaystack(row) {
  return [
    row.merchant,
    row.category,
    row.reward_text,
    row.source_text,
    row.issuer,
  ]
    .join(" ")
    .toLowerCase()
    .replace(/[’‘`´]/g, "'");
}

function compactOfferHaystack(row) {
  return compactText([
    row.merchant,
    row.category,
    row.reward_text,
    row.source_text,
    row.issuer,
  ].join(" "));
}

function rowCanonicalMerchant(row) {
  return row.canonical_merchant || row.merchant || "";
}

function rowCanonicalCategory(row) {
  return row.canonical_category || canonicalizeCategory(row.category) || row.category || "";
}

function normalizeText(input) {
  return String(input || "")
    .normalize("NFKD")
    .replace(/[’‘`´]/g, "'")
    .trim()
    .toLowerCase();
}

function compactText(input) {
  return normalizeText(input).replace(/[^a-z0-9]+/g, "");
}

function tokenSet(input) {
  return new Set(
    normalizeText(input)
      .split(/[^a-z0-9]+/i)
      .map((token) => token.trim())
      .filter((token) => token.length > 1),
  );
}

function compareOfferRows(a, b) {
  return String(a.expires_on || "9999-12-31").localeCompare(String(b.expires_on || "9999-12-31"));
}

function title(value) {
  return String(value).slice(0, 1).toUpperCase() + String(value).slice(1);
}
