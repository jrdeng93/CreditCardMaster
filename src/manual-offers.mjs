import { createHash } from "node:crypto";
import { canonicalizeCategory, listCanonicalCategoryIds } from "./canonical.mjs";
import { inferCategory, parseMaxReward, parseMinSpend, parseReward, parseUsShortDate } from "./normalize.mjs";
import { upsertOffer } from "./db.mjs";
import { formatEnabledIssuers, isIssuerEnabled, normalizeIssuerName } from "./distribution.mjs";

export function addManualOffer(db, input, options = {}) {
  const issuer = normalizeIssuer(input.issuer, options.env);
  const merchant = cleanRequired(input.merchant, "merchant");
  const rewardText = cleanRequired(input.rewardText || input.reward, "rewardText");
  const category = normalizeCategory(input.category || inferCategory(merchant, rewardText));
  const expiresOn = normalizeDate(input.expiresOn || input.expires);
  const { rewardType, rewardValue } = parseReward(rewardText);
  const sourceText = input.sourceText
    ? `manual pasted | ${String(input.sourceText).replace(/\s+/g, " ").trim().slice(0, 500)}`
    : [
    "manual",
    issuer,
    input.cardLast4 ? `****${input.cardLast4}` : null,
    merchant,
    category,
    rewardText,
    expiresOn ? `expires ${expiresOn}` : null,
  ].filter(Boolean).join(" | ");

  const offer = {
    issuer,
    cardName: cleanOptional(input.cardName),
    cardLast4: cleanOptional(input.cardLast4) || "",
    merchant,
    category,
    rewardType,
    rewardValue,
    rewardText,
    minSpend: input.minSpend ?? parseMinSpend(rewardText),
    maxReward: input.maxReward ?? parseMaxReward(rewardText),
    expiresOn,
    activationRequired: input.activationRequired ?? true,
    activated: input.activated ?? false,
    sourceText,
    sourceUrl: input.sourceUrl || null,
    rawHash: hashManualOffer({ issuer, cardLast4: input.cardLast4, merchant, category, rewardText, expiresOn }),
  };

  upsertOffer(db, offer);
  return offer;
}

export function addManualOfferFromText(db, input, options = {}) {
  const parsed = parseManualOfferText(input.text || input.sourceText || "", input);
  return addManualOffer(db, { ...input, ...parsed }, options);
}

export function parseManualOfferText(text, defaults = {}) {
  const source = cleanRequired(text, "text");
  const normalizedLines = source
    .split(/\r?\n/)
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean);
  const compactText = normalizedLines.join(" ");

  const rewardText = defaults.rewardText || defaults.reward || extractRewardText(normalizedLines, compactText);
  const merchant = defaults.merchant || extractMerchant(normalizedLines, rewardText);
  const expiresOn = defaults.expiresOn || defaults.expires || extractExpiry(compactText);
  const category = defaults.category || inferCategory(merchant, rewardText);
  const activated = defaults.activated ?? /\b(added|activated|enrolled|saved)\b/i.test(compactText);
  const activationRequired = defaults.activationRequired ?? !activated;

  return {
    merchant,
    rewardText,
    category,
    expiresOn,
    activated,
    activationRequired,
    sourceText: source,
  };
}

export function formatManualOfferResult(offer) {
  const card = offer.cardLast4 ? ` ****${offer.cardLast4}` : "";
  const status = [
    offer.activationRequired && !offer.activated ? "needs activation" : null,
    offer.activated ? "activated" : null,
    offer.expiresOn ? `expires ${offer.expiresOn}` : null,
  ].filter(Boolean).join(", ");

  return [
    "Added temporary offer:",
    `${title(offer.issuer)}${card} - ${offer.merchant}`,
    `${offer.rewardText}`,
    `${offer.category}${status ? ` | ${status}` : ""}`,
  ].join("\n");
}

function normalizeIssuer(value, env = process.env) {
  const issuer = normalizeIssuerName(cleanRequired(value, "issuer"));
  if (!isIssuerEnabled(issuer, env)) {
    throw new Error(`issuer must be one of: ${formatEnabledIssuers(env)}`);
  }
  return issuer;
}

function normalizeCategory(value) {
  const raw = cleanRequired(value, "category");
  const category = canonicalizeCategory(raw);
  if (!category) {
    throw new Error(`category must map to one of: ${listCanonicalCategoryIds().join(", ")}`);
  }
  return category;
}

function normalizeDate(value) {
  const cleaned = cleanOptional(value);
  if (!cleaned) return null;
  const short = parseUsShortDate(cleaned);
  if (short) return short;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(cleaned)) {
    throw new Error("expires must use YYYY-MM-DD");
  }
  return cleaned;
}

function extractRewardText(lines, compactText) {
  const rewardLine = lines.find((line) => looksLikeReward(line));
  if (rewardLine) return cleanupReward(rewardLine);

  const match = compactText.match(
    /((?:spend|earn|get|save|receive)\s+.{0,180}?(?:back|points?|rewards?|statement credit|off|cash back|x\b)(?:[^.。]{0,100})?)/i,
  );
  if (match) return cleanupReward(match[1]);

  throw new Error("Could not parse reward text from pasted offer.");
}

function extractMerchant(lines, rewardText) {
  const rewardIndex = lines.findIndex((line) => line.includes(rewardText) || looksLikeReward(line));
  const candidates = lines
    .slice(0, rewardIndex >= 0 ? rewardIndex : Math.min(lines.length, 4))
    .map(cleanMerchantCandidate)
    .filter((line) => line && !looksLikeBoilerplate(line));

  const merchant = candidates.find((line) => /[a-z0-9]/i.test(line));
  if (merchant) return merchant;

  throw new Error("Could not parse merchant from pasted offer.");
}

function extractExpiry(text) {
  const iso = text.match(/\b(20\d{2}-\d{2}-\d{2})\b/);
  if (iso) return iso[1];

  const short = text.match(/\b(?:expires?|expiration(?: date)?|valid through|through)\s*:?\s*(\d{1,2}\/\d{1,2}\/\d{2})\b/i);
  if (short) return parseUsShortDate(short[1]);

  const long = text.match(/\b(?:expires?|expiration(?: date)?|valid through|through)\s*:?\s*([A-Z][a-z]+)\s+(\d{1,2}),\s+(20\d{2})\b/i);
  if (long) {
    const month = monthNumber(long[1]);
    if (month) return `${long[3]}-${month}-${String(long[2]).padStart(2, "0")}`;
  }

  const bareShort = text.match(/\b(\d{1,2}\/\d{1,2}\/\d{2})\b/);
  return bareShort ? parseUsShortDate(bareShort[1]) : null;
}

function looksLikeReward(line) {
  return /\b(spend|get|earn|save|receive)\b/i.test(line) &&
    /(\$[\d,]+|[\d.]+\s*x\b|[\d.]+%\s+(?:cash\s+)?back|points?|statement credit|off|cash back)/i.test(line);
}

function cleanupReward(value) {
  return String(value || "")
    .replace(/\b(?:expires?|expiration(?: date)?|valid through|terms apply|view details)\b.*$/i, "")
    .replace(/\s+/g, " ")
    .trim();
}

function cleanMerchantCandidate(value) {
  return String(value || "")
    .replace(/^(?:new|added|offer|offers?)\b[:\s-]*/i, "")
    .replace(/\b(?:terms apply|view details)\b.*$/i, "")
    .trim();
}

function looksLikeBoilerplate(value) {
  return /^(?:new|added|offer|offers?|terms apply|view details|expires?|expiration|enroll|activate|activated|saved)$/i.test(value) ||
    looksLikeReward(value);
}

function monthNumber(name) {
  const months = {
    january: "01",
    february: "02",
    march: "03",
    april: "04",
    may: "05",
    june: "06",
    july: "07",
    august: "08",
    september: "09",
    october: "10",
    november: "11",
    december: "12",
  };
  return months[String(name || "").toLowerCase()] || null;
}

function cleanRequired(value, field) {
  const cleaned = cleanOptional(value);
  if (!cleaned) throw new Error(`${field} is required`);
  return cleaned;
}

function cleanOptional(value) {
  if (value == null) return null;
  const cleaned = String(value).trim();
  return cleaned || null;
}

function hashManualOffer(values) {
  return createHash("sha256")
    .update(JSON.stringify(values))
    .digest("hex")
    .slice(0, 24);
}

function title(value) {
  return String(value).slice(0, 1).toUpperCase() + String(value).slice(1);
}
