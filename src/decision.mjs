import { applyWalletStrategyToCandidate } from "./wallet-strategy.mjs";

export function buildDecision(result) {
  const offerCandidates = (result.offers || [])
    .filter((offer) => isOfferEligibleForBestChoice(offer, result.intent))
    .map((offer) => buildOfferCandidate(offer, result.intent));
  const baseCandidates = (result.recommendations || []).map((recommendation) => {
    const candidate = buildBaseCardCandidate(recommendation);
    if (!candidate) return null;
    if (recommendation.adjustedScore != null) {
      return {
        ...candidate,
        score: recommendation.adjustedScore,
        walletAdjustments: recommendation.walletAdjustments || [],
        rewardCurrency: recommendation.rewardCurrency,
        pointValueCents: recommendation.pointValueCents,
      };
    }
    return applyWalletStrategyToCandidate(candidate, {
      intent: result.intent,
      strategy: result.walletStrategy,
    });
  });
  const candidates = [...offerCandidates, ...baseCandidates]
    .filter(Boolean)
    .sort((a, b) => b.score - a.score || a.label.localeCompare(b.label));

  if (!candidates.length) {
    return {
      type: "fallback",
      label: "Your normal fallback card",
      summary: "No matching offer or base-card rule found.",
      reason: "Use your normal fallback card, or add a manual offer if this is a targeted bonus.",
      score: 0,
    };
  }

  return candidates[0];
}

export function formatDecision(decision) {
  return [
    "Best choice:",
    `${decision.label} - ${decision.summary}`,
    decision.reason ? `Why: ${decision.reason}` : null,
  ].filter(Boolean).join("\n");
}

function buildOfferCandidate(row, intent = {}) {
  const rewardScore = rewardValueScore(row);
  const activationPenalty = row.activation_required && !row.activated ? 8 : 0;
  const manualBonus = isManualOffer(row) ? 8 : 0;
  const merchantMatchBonus = intent.merchant ? 600 : 0;
  const score = 70 + merchantMatchBonus + rewardScore + manualBonus - activationPenalty;
  const card = compactOfferCard(row);
  const flags = [
    row.activation_required && !row.activated ? "activate first" : null,
    row.expires_on ? `expires ${row.expires_on}` : null,
  ].filter(Boolean);

  return {
    type: "offer",
    row,
    label: [title(row.issuer), card].filter(Boolean).join(" "),
    summary: `${row.merchant}: ${row.reward_text}`,
    reason: flags.length
      ? `Offer match; ${flags.join(", ")}.`
      : "Offer match beats normal base earning.",
    score,
  };
}

function buildBaseCardCandidate(item) {
  const rule = item.matchedRules?.[0];
  if (!rule) return null;
  const confidenceAdjustment = item.card.lastVerifiedAt ? 1 : item.card.verified ? 3 : -5;
  return {
    type: "base_card",
    card: item.card,
    rule,
    label: cardLabel(item.card),
    summary: rule.summary,
    reason: rule.fallback
      ? "No matching offer found; use this fallback card for uncategorized spend."
      : item.card.verified || item.card.lastVerifiedAt
      ? "Base card benefit match."
      : "Base card benefit match, but verify current terms before relying on it.",
    score: (rule.score || 0) * 10 + confidenceAdjustment,
  };
}

function isOfferEligibleForBestChoice(row, intent = {}) {
  if (intent.merchant) return true;
  if (isManualOffer(row)) return true;
  return false;
}

function rewardValueScore(row) {
  if (row.reward_type === "percent" || row.reward_type === "multiplier") {
    return Math.min(Number(row.reward_value || 0) * 6, 45);
  }

  if (row.reward_type === "fixed_cash") {
    if (row.min_spend && row.max_reward) {
      const impliedRate = (Number(row.max_reward) / Number(row.min_spend)) * 100;
      return Math.min(impliedRate * 5, 45);
    }
    return 18;
  }

  const text = String(row.reward_text || "").toLowerCase();
  const multiplier = text.match(/\b(\d+(?:\.\d+)?)\s*x\b/);
  if (multiplier) return Math.min(Number(multiplier[1]) * 6, 45);

  return 8;
}

function isManualOffer(row) {
  return String(row.source_text || "").toLowerCase().startsWith("manual");
}

function compactOfferCard(row) {
  return row.card_last4 ? `****${row.card_last4}` : row.card_name || "";
}

function cardLabel(card) {
  const issuer = title(card.issuer);
  const name = String(card.cardName || "");
  const label = name.toLowerCase().startsWith(String(card.issuer).toLowerCase())
    ? name
    : `${issuer} ${name}`;
  return card.cardLast4 ? `${label} ****${card.cardLast4}` : label;
}

function title(value) {
  return String(value).slice(0, 1).toUpperCase() + String(value).slice(1);
}
