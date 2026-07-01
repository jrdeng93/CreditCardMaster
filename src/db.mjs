import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { getDbPath } from "./config.mjs";
import { canonicalizeOffer } from "./canonical.mjs";

export function openDb(path = getDbPath()) {
  mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA busy_timeout = 5000");
  db.exec("PRAGMA foreign_keys = ON");
  return db;
}

export function migrate(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS offers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      issuer TEXT NOT NULL,
      card_name TEXT,
      card_last4 TEXT,
      merchant TEXT NOT NULL,
      category TEXT NOT NULL,
      reward_type TEXT NOT NULL,
      reward_value REAL,
      reward_text TEXT NOT NULL,
      min_spend REAL,
      max_reward REAL,
      expires_on TEXT,
      activation_required INTEGER NOT NULL DEFAULT 1,
      activated INTEGER NOT NULL DEFAULT 0,
      source_text TEXT NOT NULL,
      source_url TEXT,
      raw_hash TEXT NOT NULL,
      first_seen_at TEXT NOT NULL,
      last_seen_at TEXT NOT NULL,
      UNIQUE (issuer, card_last4, raw_hash)
    );

    CREATE TABLE IF NOT EXISTS scrape_runs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      issuer TEXT NOT NULL,
      status TEXT NOT NULL,
      started_at TEXT NOT NULL,
      finished_at TEXT,
      message TEXT
    );

    CREATE TABLE IF NOT EXISTS watchlist (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      kind TEXT NOT NULL,
      value TEXT NOT NULL,
      canonical_merchant TEXT,
      canonical_category TEXT,
      created_at TEXT NOT NULL,
      UNIQUE (kind, value)
    );

    CREATE TABLE IF NOT EXISTS doc_monitor_items (
      url TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      category TEXT,
      first_seen_at TEXT NOT NULL,
      last_seen_at TEXT NOT NULL,
      last_comment_count INTEGER NOT NULL DEFAULT 0,
      last_sent_at TEXT,
      last_sent_comment_count INTEGER
    );

    CREATE INDEX IF NOT EXISTS idx_offers_merchant ON offers(merchant);
    CREATE INDEX IF NOT EXISTS idx_offers_category ON offers(category);
    CREATE INDEX IF NOT EXISTS idx_offers_expires ON offers(expires_on);
    CREATE INDEX IF NOT EXISTS idx_watchlist_category ON watchlist(canonical_category);
    CREATE INDEX IF NOT EXISTS idx_watchlist_merchant ON watchlist(canonical_merchant);
    CREATE INDEX IF NOT EXISTS idx_doc_monitor_last_seen ON doc_monitor_items(last_seen_at);
    CREATE INDEX IF NOT EXISTS idx_doc_monitor_last_sent ON doc_monitor_items(last_sent_at);
  `);

  addColumnIfMissing(db, "scrape_runs", "snapshot_path", "TEXT");
  addColumnIfMissing(db, "scrape_runs", "offers_seen", "INTEGER NOT NULL DEFAULT 0");
  addColumnIfMissing(db, "scrape_runs", "offers_imported", "INTEGER NOT NULL DEFAULT 0");
  addColumnIfMissing(db, "scrape_runs", "warnings", "TEXT");

  addColumnIfMissing(db, "offers", "canonical_merchant", "TEXT");
  addColumnIfMissing(db, "offers", "canonical_category", "TEXT");
  addColumnIfMissing(db, "offers", "category_confidence", "REAL");
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_offers_canonical_merchant ON offers(canonical_merchant);
    CREATE INDEX IF NOT EXISTS idx_offers_canonical_category ON offers(canonical_category);
  `);
  backfillCanonicalOffers(db);
}

export function upsertOffer(db, offer) {
  const now = new Date().toISOString();
  const canonical = canonicalizeOffer(offer);
  const stmt = db.prepare(`
    INSERT INTO offers (
      issuer, card_name, card_last4, merchant, category, reward_type, reward_value,
      reward_text, min_spend, max_reward, expires_on, activation_required, activated,
      source_text, source_url, raw_hash, canonical_merchant, canonical_category,
      category_confidence, first_seen_at, last_seen_at
    ) VALUES (
      @issuer, @cardName, @cardLast4, @merchant, @category, @rewardType, @rewardValue,
      @rewardText, @minSpend, @maxReward, @expiresOn, @activationRequired, @activated,
      @sourceText, @sourceUrl, @rawHash, @canonicalMerchant, @canonicalCategory,
      @categoryConfidence, @now, @now
    )
    ON CONFLICT(issuer, card_last4, raw_hash) DO UPDATE SET
      card_name = excluded.card_name,
      merchant = excluded.merchant,
      category = excluded.category,
      canonical_merchant = excluded.canonical_merchant,
      canonical_category = excluded.canonical_category,
      category_confidence = excluded.category_confidence,
      reward_type = excluded.reward_type,
      reward_value = excluded.reward_value,
      reward_text = excluded.reward_text,
      min_spend = excluded.min_spend,
      max_reward = excluded.max_reward,
      expires_on = excluded.expires_on,
      activation_required = excluded.activation_required,
      activated = excluded.activated,
      source_text = excluded.source_text,
      source_url = excluded.source_url,
      last_seen_at = excluded.last_seen_at
  `);

  stmt.run({
    issuer: offer.issuer,
    cardName: offer.cardName ?? null,
    cardLast4: offer.cardLast4 ?? "",
    merchant: offer.merchant,
    category: offer.category,
    rewardType: offer.rewardType,
    rewardValue: offer.rewardValue ?? null,
    rewardText: offer.rewardText,
    minSpend: offer.minSpend ?? null,
    maxReward: offer.maxReward ?? null,
    expiresOn: offer.expiresOn ?? null,
    activationRequired: offer.activationRequired ? 1 : 0,
    activated: offer.activated ? 1 : 0,
    sourceText: offer.sourceText,
    sourceUrl: offer.sourceUrl ?? null,
    rawHash: offer.rawHash,
    canonicalMerchant: offer.canonicalMerchant ?? canonical.canonicalMerchant,
    canonicalCategory: offer.canonicalCategory ?? canonical.canonicalCategory,
    categoryConfidence: offer.categoryConfidence ?? canonical.categoryConfidence,
    now,
  });
}

export function offerExists(db, { issuer, cardLast4, rawHash }) {
  const row = db.prepare(
    `SELECT id FROM offers
     WHERE issuer = @issuer AND card_last4 = @cardLast4 AND raw_hash = @rawHash
     LIMIT 1`,
  ).get({
    issuer,
    cardLast4: cardLast4 ?? "",
    rawHash,
  });
  return Boolean(row);
}

export function getStatus(db) {
  const total = db.prepare("SELECT count(*) AS count FROM offers").get().count;
  const byIssuer = db
    .prepare("SELECT issuer, count(*) AS count FROM offers GROUP BY issuer ORDER BY issuer")
    .all();
  const newest = db
    .prepare("SELECT max(last_seen_at) AS lastSeenAt FROM offers")
    .get().lastSeenAt;
  const lastRuns = db
    .prepare(
      `SELECT issuer, status, started_at AS startedAt, finished_at AS finishedAt, message
              , snapshot_path AS snapshotPath, offers_seen AS offersSeen, offers_imported AS offersImported, warnings
       FROM scrape_runs
       ORDER BY datetime(started_at) DESC
       LIMIT 5`,
    )
    .all();

  return { total, byIssuer, newest, lastRuns };
}

export function recordScrapeRun(db, { issuer, status, message }) {
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO scrape_runs (issuer, status, started_at, finished_at, message)
     VALUES (@issuer, @status, @now, @now, @message)`,
  ).run({
    issuer,
    status,
    now,
    message: message ?? null,
  });
}

export function startScrapeRun(db, { issuer, status = "running", message = null, snapshotPath = null }) {
  const now = new Date().toISOString();
  const result = db.prepare(
    `INSERT INTO scrape_runs (issuer, status, started_at, message, snapshot_path)
     VALUES (@issuer, @status, @now, @message, @snapshotPath)`,
  ).run({
    issuer,
    status,
    now,
    message,
    snapshotPath,
  });
  return Number(result.lastInsertRowid);
}

export function finishScrapeRun(db, runId, {
  status,
  message = null,
  snapshotPath = null,
  offersSeen = 0,
  offersImported = 0,
  warnings = [],
}) {
  const now = new Date().toISOString();
  db.prepare(
    `UPDATE scrape_runs
     SET status = @status,
         finished_at = @now,
         message = @message,
         snapshot_path = COALESCE(@snapshotPath, snapshot_path),
         offers_seen = @offersSeen,
         offers_imported = @offersImported,
         warnings = @warnings
     WHERE id = @runId`,
  ).run({
    runId,
    status,
    now,
    message,
    snapshotPath,
    offersSeen,
    offersImported,
    warnings: warnings.length ? JSON.stringify(warnings) : null,
  });
}

function addColumnIfMissing(db, table, column, definition) {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all();
  if (columns.some((item) => item.name === column)) return;
  db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
}

function backfillCanonicalOffers(db) {
  const rows = db
    .prepare(
      `SELECT id, merchant, category, reward_text AS rewardText, source_text AS sourceText
       FROM offers`,
    )
    .all();

  const stmt = db.prepare(
    `UPDATE offers
     SET canonical_merchant = @canonicalMerchant,
         canonical_category = @canonicalCategory,
         category_confidence = @categoryConfidence
     WHERE id = @id`,
  );

  for (const row of rows) {
    const canonical = canonicalizeOffer(row);
    stmt.run({
      id: row.id,
      canonicalMerchant: canonical.canonicalMerchant,
      canonicalCategory: canonical.canonicalCategory,
      categoryConfidence: canonical.categoryConfidence,
    });
  }
}
