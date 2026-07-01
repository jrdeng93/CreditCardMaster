import { classifyQuery, compactText } from "./canonical.mjs";

const VALID_KINDS = new Set(["merchant", "category", "query"]);

export function addWatch(db, value, options = {}) {
  const cleaned = cleanValue(value);
  const profile = classifyQuery(cleaned);
  const kind = normalizeKind(options.kind || inferKind(profile));
  const now = new Date().toISOString();

  db.prepare(
    `INSERT INTO watchlist (kind, value, canonical_merchant, canonical_category, created_at)
     VALUES (@kind, @value, @canonicalMerchant, @canonicalCategory, @now)
     ON CONFLICT(kind, value) DO UPDATE SET
       canonical_merchant = excluded.canonical_merchant,
       canonical_category = excluded.canonical_category`,
  ).run({
    kind,
    value: cleaned,
    canonicalMerchant: profile.canonicalMerchant,
    canonicalCategory: profile.canonicalCategory,
    now,
  });

  return { kind, value: cleaned, ...profile };
}

export function removeWatch(db, value) {
  const cleaned = cleanValue(value);
  const result = db
    .prepare("DELETE FROM watchlist WHERE value = @value OR lower(value) = lower(@value)")
    .run({ value: cleaned });
  return { value: cleaned, removed: result.changes || 0 };
}

export function listWatchlist(db) {
  return db
    .prepare(
      `SELECT kind, value, canonical_merchant AS canonicalMerchant, canonical_category AS canonicalCategory, created_at AS createdAt
       FROM watchlist
       ORDER BY kind ASC, value ASC`,
    )
    .all();
}

export function findWatchlistMatches(db, intent = {}) {
  const rows = listWatchlist(db);
  return rows.filter((row) => watchMatchesIntent(row, intent));
}

export function formatWatchResult(item) {
  return [
    "Added watch:",
    `${item.kind}: ${item.value}`,
    item.canonicalMerchant ? `merchant=${item.canonicalMerchant}` : null,
    item.canonicalCategory ? `category=${item.canonicalCategory}` : null,
  ].filter(Boolean).join("\n");
}

export function formatRemoveWatchResult(result) {
  return result.removed
    ? `Removed watch: ${result.value}`
    : `No watch found for: ${result.value}`;
}

export function formatWatchlist(rows) {
  if (!rows.length) return "Watchlist is empty.";
  return rows
    .map((row) => {
      const parts = [
        row.canonicalMerchant ? `merchant=${row.canonicalMerchant}` : null,
        row.canonicalCategory ? `category=${row.canonicalCategory}` : null,
      ].filter(Boolean);
      return `- ${row.kind}: ${row.value}${parts.length ? ` (${parts.join(", ")})` : ""}`;
    })
    .join("\n");
}

function watchMatchesIntent(row, intent) {
  if (row.canonicalMerchant && intent.merchant) {
    return compactText(row.canonicalMerchant) === compactText(intent.merchant);
  }
  if (row.canonicalCategory && intent.category) return row.canonicalCategory === intent.category;
  const raw = String(intent.rawQuery || "");
  return raw && compactText(row.value).length >= 3 && compactText(raw).includes(compactText(row.value));
}

function inferKind(profile) {
  if (profile.canonicalMerchant) return "merchant";
  if (profile.canonicalCategory) return "category";
  return "query";
}

function normalizeKind(value) {
  const kind = String(value || "").trim().toLowerCase();
  if (!VALID_KINDS.has(kind)) throw new Error(`kind must be one of: ${[...VALID_KINDS].join(", ")}`);
  return kind;
}

function cleanValue(value) {
  const cleaned = String(value || "").trim();
  if (!cleaned) throw new Error("watch value is required");
  return cleaned;
}
