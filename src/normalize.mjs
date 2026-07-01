export function parseUsShortDate(value) {
  const match = String(value || "").match(/^(\d{1,2})\/(\d{1,2})\/(\d{2})$/);
  if (!match) return null;

  const [, month, day, yy] = match;
  const year = 2000 + Number(yy);
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export function inferCategory(merchant, rewardText = "") {
  const text = `${merchant} ${rewardText}`.toLowerCase();

  if (/(restaurant|dining|olive garden|qdoba|coffee|pizza|burger|doordash|resy)/.test(text)) {
    return "restaurant";
  }
  if (/(hotel|travel|airfare|flight|expedia|hotels\.com|resort|airline|airport|las vegas|fontainebleau)/.test(text)) {
    return "travel";
  }
  if (/(grocery|whole foods|supermarket|\bmarket\b|\bmarketplace grocery\b)/.test(text)) {
    return "grocery";
  }
  if (/(stream|subscription|hulu|disney|paramount|amc\+)/.test(text)) return "streaming";
  if (/\b(gas|fuel|charging)\b/.test(text)) return "gas";
  if (/(insurance|loan|creditsecure)/.test(text)) return "financial";
  if (/(macy's|macys|saks|nordstrom|department store)/.test(text)) return "department_store";

  return "shopping";
}

export function parseReward(rewardText) {
  const text = String(rewardText || "");
  const percent = text.match(/(?:earn\s+|up to\s+)?(\d+(?:\.\d+)?)%\s+(?:cash\s+)?back/i);
  if (percent) {
    return { rewardType: "percent", rewardValue: Number(percent[1]) };
  }

  const multiplier = text.match(/\b(\d+(?:\.\d+)?)\s*x\b/i);
  if (multiplier) {
    return { rewardType: "multiplier", rewardValue: Number(multiplier[1]) };
  }

  const fixed = text.match(/(?:earn\s+)?\$?([\d,]+(?:\.\d+)?)\s*(?:usd\s*)?(?:cash\s+)?back/i);
  if (fixed) {
    return { rewardType: "fixed_cash", rewardValue: Number(fixed[1].replaceAll(",", "")) };
  }

  const points = text.match(/earn\s+\+?([\d,]+(?:\.\d+)?)\s+membership rewards/i);
  if (points) {
    return { rewardType: "points", rewardValue: Number(points[1].replaceAll(",", "")) };
  }

  return { rewardType: "unknown", rewardValue: null };
}

export function parseMinSpend(rewardText) {
  const match = String(rewardText || "").match(/spend\s+\$?([\d,]+(?:\.\d+)?)\s*(?:usd\s*)?(?:or more|\+)/i);
  return match ? Number(match[1].replaceAll(",", "")) : null;
}

export function parseMaxReward(rewardText) {
  const text = String(rewardText || "");
  const total = text.match(/(?:up to (?:a )?total of|total of)\s+\$?([\d,]+(?:\.\d+)?)/i);
  if (total) return Number(total[1].replaceAll(",", ""));

  const earn = text.match(/earn\s+\$?([\d,]+(?:\.\d+)?)\s*(?:usd\s*)?back/i);
  return earn ? Number(earn[1].replaceAll(",", "")) : null;
}
