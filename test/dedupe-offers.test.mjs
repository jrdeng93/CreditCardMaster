import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { dedupeOffers, formatDedupeOffersResult, getDuplicateOfferSummary } from "../src/dedupe-offers.mjs";
import { migrate, openDb, upsertOffer } from "../src/db.mjs";
import { searchOffers } from "../src/search.mjs";

test("dedupe offers defaults to dry-run and does not delete rows", () => {
  const db = setupDb();
  seedDuplicateOffers(db);

  const result = dedupeOffers(db);

  assert.equal(result.applied, false);
  assert.equal(result.groupCount, 1);
  assert.equal(result.duplicateRows, 1);
  assert.equal(result.duplicateGroups.length, 1);
  assert.equal(searchOffers(db, "macy").length, 2);
  assert.match(formatDedupeOffersResult(result), /Dry run: 1 duplicate offer rows/);
});

test("dedupe offers apply deletes duplicate rows and keeps one copy", () => {
  const db = setupDb();
  seedDuplicateOffers(db);

  const result = dedupeOffers(db, { apply: true });

  assert.equal(result.applied, true);
  assert.equal(result.deletedRows, 1);
  assert.deepEqual(getDuplicateOfferSummary(db), { groupCount: 0, duplicateRows: 0 });
  assert.equal(searchOffers(db, "macy").length, 1);
});

function setupDb() {
  const dir = mkdtempSync(join(tmpdir(), "ccm-dedupe-"));
  const db = openDb(join(dir, "offers.sqlite"));
  migrate(db);
  return db;
}

function seedDuplicateOffers(db) {
  const base = {
    issuer: "amex",
    cardName: "Platinum Card",
    cardLast4: "9999",
    merchant: "Macy's",
    category: "shopping",
    rewardType: "fixed_cash",
    rewardValue: 15,
    rewardText: "Spend $100 or more, earn $15 back",
    minSpend: 100,
    maxReward: 15,
    expiresOn: "2099-12-31",
    activationRequired: true,
    activated: false,
    sourceText: "Macy's Spend $100 or more, earn $15 back",
  };

  upsertOffer(db, { ...base, rawHash: "first-hash" });
  upsertOffer(db, { ...base, rawHash: "second-hash" });
}
