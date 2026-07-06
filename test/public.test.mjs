import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { askWithRecommendations, formatSearchWithRecommendations, loadCardBenefits } from "../src/benefits.mjs";
import { askCCM, routeAskCCM } from "../src/ask-ccm.mjs";
import { migrate, openDb, upsertOffer } from "../src/db.mjs";
import { addManualOfferFromText, parseManualOfferText } from "../src/manual-offers.mjs";
import { buildPortalChecks, formatPortalCheck } from "../src/portals.mjs";
import { searchOffers } from "../src/search.mjs";
import { formatSetupDoctor, runSetupDoctor } from "../src/setup-doctor.mjs";

test("public card catalog contains Amex cards without personal last four digits", () => {
  withPublicDistribution(() => {
    const data = loadCardBenefits();
    assert.ok(data.cards.length >= 1);
    assert.ok(data.cards.every((card) => card.issuer === "amex"));
    assert.ok(data.cards.every((card) => !card.cardLast4));
  });
});

test("public search hides non-Amex rows from an existing local DB", () => {
  const db = setupPublicDb();
  upsertOffer(db, offer({
    issuer: "chase",
    merchant: "Private gas bonus",
    category: "gas",
    rewardText: "5X gas for 3 months",
    rawHash: "private-chase-gas",
  }));

  withPublicDistribution(() => {
    assert.equal(searchOffers(db, "gas").length, 0);
  });
});

test("public advisor auto-matches output language", async () => {
  const db = setupPublicDb();
  upsertOffer(db, offer({
    merchant: "Macy's",
    category: "department_store",
    rewardText: "Spend $50 or more, earn $10 back",
    rawHash: "public-amex-macys",
  }));

  await withPublicDistribution(async () => {
    const english = formatSearchWithRecommendations(await askWithRecommendations(db, "macy's", { disableLlm: true }));
    assert.match(english, /^Recognized: Macy's\nUse:/);
    assert.match(english, /Macy's - Spend \$50 or more, earn \$10 back/);
    assert.match(english, /Before paying:/);

    const chinese = formatSearchWithRecommendations(await askWithRecommendations(db, "今晚吃饭", { disableLlm: true }));
    assert.match(chinese, /^识别: dining\n使用:/);
    assert.match(chinese, /Amex Gold Card/);
  });
});

test("general ask router detects module intent before checkout fallback", async () => {
  const db = setupPublicDb();

  await withPublicDistribution(async () => {
    assert.equal(routeAskCCM("有没有快过期的offer").type, "expiring");
    assert.equal(routeAskCCM("check rakuten macy's").type, "portal");
    assert.equal(routeAskCCM("show wallet strategy").type, "wallet");
    assert.equal(routeAskCCM("where should I use for dinner").type, "checkout");

    const expiring = await askCCM(db, "有没有快过期的offer");
    assert.match(expiring.output, /^CCM: 未来 14 天快过期的 offer/);

    const portal = await askCCM(db, "check rakuten macy's");
    assert.match(portal.output, /Shopping portal check/);
    assert.match(portal.output, /https:\/\/www\.rakuten\.com\/shop\/macys/);
  });
});

test("fallback intent recognizes common English dining moments", async () => {
  const db = setupPublicDb();

  await withPublicDistribution(async () => {
    const result = await askWithRecommendations(db, "where should I use for dinner", { disableLlm: true });

    assert.equal(result.intent.category, "dining");
    assert.equal(result.decision.type, "base_card");
    assert.match(result.decision.summary, /restaurants|dining/i);
  });
});

test("public advisor selects merchant offer over fallback card", async () => {
  const db = setupPublicDb();
  upsertOffer(db, offer({
    merchant: "Macy's",
    category: "department_store",
    rewardText: "Spend $50 or more, earn $10 back",
    rawHash: "public-amex-macys-selected",
  }));

  await withPublicDistribution(async () => {
    const result = await askWithRecommendations(db, "macy's", { disableLlm: true });
    const output = formatSearchWithRecommendations(result);

    assert.equal(result.decision.type, "offer");
    assert.match(result.decision.summary, /Macy's/);
    assert.match(output, /Use:\nAmex - Macy's: Spend \$50 or more, earn \$10 back/);
    assert.match(output, /Before paying:/);
    assert.match(output, /Check Rakuten cash back: https:\/\/www\.rakuten\.com\/shop\/macys/);
  });
});

test("public advisor infers merchant intent from matching offer results", async () => {
  const db = setupPublicDb();
  upsertOffer(db, offer({
    merchant: "Acme Wireless",
    category: "general_shopping",
    rewardType: "percent",
    rewardValue: 25,
    rewardText: "25% cash back",
    rawHash: "public-acme-wireless-offer-inferred",
  }));

  await withPublicDistribution(async () => {
    const result = await askWithRecommendations(db, "acme", { disableLlm: true });
    const output = formatSearchWithRecommendations(result);

    assert.equal(result.intent.merchant, "Acme Wireless");
    assert.equal(result.intent.inferredFromOffers, true);
    assert.equal(result.decision.type, "offer");
    assert.match(output, /Use:\nAmex - Acme Wireless: 25% cash back/);
  });
});

test("public advisor skips matching offer when purchase amount is below minimum spend", async () => {
  const db = setupPublicDb();
  upsertOffer(db, offer({
    merchant: "Macy's",
    category: "department_store",
    rewardText: "Spend $100 or more, earn $20 back",
    minSpend: 100,
    maxReward: 20,
    rawHash: "public-amex-macys-min-spend",
  }));

  await withPublicDistribution(async () => {
    const result = await askWithRecommendations(db, "macy's $30", { disableLlm: true });
    const output = formatSearchWithRecommendations(result);

    assert.equal(result.offers.length, 1);
    assert.equal(result.decision.type, "base_card");
    assert.match(result.decision.reason, /does not meet this purchase amount/);
    assert.match(output, /Use:\nAmex Blue Business Plus Card/);
    assert.doesNotMatch(output, /Activate Amex offer: Macy's/);
  });
});

test("public advisor keeps matching offer eligible when purchase amount reaches minimum spend", async () => {
  const db = setupPublicDb();
  upsertOffer(db, offer({
    merchant: "Macy's",
    category: "department_store",
    rewardText: "Spend $100 or more, earn $20 back",
    minSpend: 100,
    maxReward: 20,
    rawHash: "public-amex-macys-min-spend-met",
  }));

  await withPublicDistribution(async () => {
    const result = await askWithRecommendations(db, "macy's $120", { disableLlm: true });

    assert.equal(result.decision.type, "offer");
    assert.match(result.decision.summary, /Spend \$100 or more/);
  });
});

test("public advisor recommends a fallback card when no offer matches", async () => {
  const db = setupPublicDb();

  await withPublicDistribution(async () => {
    const result = await askWithRecommendations(db, "macy's", { disableLlm: true });
    const output = formatSearchWithRecommendations(result);

    assert.equal(result.offers.length, 0);
    assert.equal(result.decision.type, "base_card");
    assert.match(result.decision.label, /Amex Blue Business Plus Card/);
    assert.match(result.decision.reason, /No matching offer found/);
    assert.match(output, /No matching offers/);
    assert.match(output, /Use:\nAmex Blue Business Plus Card/);
    assert.doesNotMatch(output, /Alternatives:/);
  });
});

test("public advisor only shows activation steps for the selected offer", async () => {
  const db = setupPublicDb();
  upsertOffer(db, offer({
    merchant: "Example shopping store",
    category: "general_shopping",
    rewardText: "Spend $100, get $10 back",
    rawHash: "public-generic-shopping",
  }));

  await withPublicDistribution(async () => {
    const result = await askWithRecommendations(db, "shopping", { disableLlm: true });
    const output = formatSearchWithRecommendations(result);

    assert.equal(result.decision.type, "base_card");
    assert.match(output, /Related offers \(not selected\):/);
    assert.doesNotMatch(output, /Activate Amex offer: Example shopping store/);
  });
});

test("bestcard formatting hides related offer list", async () => {
  const db = setupPublicDb();
  upsertOffer(db, offer({
    merchant: "Example shopping store",
    category: "general_shopping",
    rewardText: "Spend $100, get $10 back",
    rawHash: "public-bestcard-shopping",
  }));

  await withPublicDistribution(async () => {
    const result = await askWithRecommendations(db, "shopping", { disableLlm: true });
    const output = formatSearchWithRecommendations(result, { showOffers: false });

    assert.match(output, /Use:\nAmex Blue Business Plus Card/);
    assert.doesNotMatch(output, /Relevant offers:/);
    assert.doesNotMatch(output, /Related offers/);
  });
});

test("wallet strategy can override fallback card", async () => {
  const db = setupPublicDb();

  await withPublicDistribution(async () => {
    const result = await askWithRecommendations(db, "shopping", {
      disableLlm: true,
      walletStrategy: {
        pointsValueCents: { cash: 1, mr: 1.5 },
        defaultFallbackCard: "amex:Blue Cash Preferred Card:",
        categoryFallbackCards: {
          general_shopping: "amex:Blue Cash Preferred Card:",
        },
      },
    });

    assert.equal(result.decision.type, "base_card");
    assert.match(result.decision.label, /Amex Blue Cash Preferred Card/);
  });
});

test("paste offer parser extracts merchant reward expiry and imports searchable offer", async () => {
  const db = setupPublicDb();
  const text = [
    "NEW",
    "Macy's",
    "Spend $50 or more, earn $10 back",
    "Expires 8/31/26",
    "Terms apply",
    "View Details",
  ].join("\n");

  await withPublicDistribution(async () => {
    const parsed = parseManualOfferText(text);
    assert.equal(parsed.merchant, "Macy's");
    assert.equal(parsed.rewardText, "Spend $50 or more, earn $10 back");
    assert.equal(parsed.expiresOn, "2026-08-31");
    assert.equal(parsed.category, "department_store");
    assert.equal(parsed.activationRequired, true);

    const offer = addManualOfferFromText(db, { issuer: "amex", text });
    assert.equal(offer.rewardType, "fixed_cash");
    assert.equal(offer.rewardValue, 10);

    const result = await askWithRecommendations(db, "macy's", { disableLlm: true });
    assert.equal(result.decision.type, "offer");
    assert.match(formatSearchWithRecommendations(result), /Macy's - Spend \$50 or more, earn \$10 back/);
  });
});

test("paste offer parser handles points language and activated state", () => {
  const parsed = parseManualOfferText([
    "Olive Garden",
    "Earn +2 Membership Rewards points per eligible dollar spent, up to 5,000 points",
    "Expires September 30, 2026",
    "Added to Card",
  ].join("\n"));

  assert.equal(parsed.merchant, "Olive Garden");
  assert.match(parsed.rewardText, /Membership Rewards/);
  assert.equal(parsed.expiresOn, "2026-09-30");
  assert.equal(parsed.category, "restaurant");
  assert.equal(parsed.activated, true);
  assert.equal(parsed.activationRequired, false);
});

test("rakuten portal checks are suggested for shopping merchants and skipped for dining categories", () => {
  const merchantChecks = buildPortalChecks({ merchant: "Macy's", category: "department_store" });
  assert.equal(merchantChecks.length, 1);
  assert.equal(merchantChecks[0].provider, "Rakuten");
  assert.equal(merchantChecks[0].url, "https://www.rakuten.com/shop/macys");
  assert.match(formatPortalCheck(merchantChecks[0], "zh"), /检查 Rakuten 返现入口/);

  const nikeChecks = buildPortalChecks({ merchant: "Nike", category: "clothing" });
  assert.equal(nikeChecks[0].url, "https://www.rakuten.com/shop/nike");

  const lululemonChecks = buildPortalChecks({ merchant: "lululemom", category: "clothing" });
  assert.equal(lululemonChecks[0].url, "https://www.rakuten.com/shop/lululemon");

  const visibleChecks = buildPortalChecks({ merchant: "Visible by Verizon", category: "general_shopping" });
  assert.equal(visibleChecks[0].url, "https://www.rakuten.com/shop/visible");

  const categoryChecks = buildPortalChecks({ category: "general_shopping", rawQuery: "shopping" });
  assert.equal(categoryChecks[0].url, "https://www.rakuten.com/");

  const diningChecks = buildPortalChecks({ category: "dining", rawQuery: "今晚吃饭" });
  assert.equal(diningChecks.length, 0);
});

test("setup doctor summarizes public setup state", async () => {
  const db = setupPublicDb();

  await withPublicDistribution(() => {
    const result = runSetupDoctor(db, {
      env: {
        CCM_DISTRIBUTION: "public",
        DISCORD_BOT_TOKEN: "test",
        DISCORD_CLIENT_ID: "test",
        DISCORD_GUILD_ID: "test",
        DISCORD_ALLOWED_USER_IDS: "123",
        CREDITCARDMASTER_DISCORD_WEBHOOK_URL: "https://example.invalid/webhook",
        OLLAMA_MODEL: "qwen3:4b",
      },
    });
    const output = formatSetupDoctor(result);

    assert.match(output, /CreditCardMaster setup doctor/);
    assert.match(output, /Distribution: public/);
    assert.match(output, /Wallet strategy:/);
  });
});

function setupPublicDb() {
  const dir = mkdtempSync(join(tmpdir(), "ccm-public-"));
  const db = openDb(join(dir, "offers.sqlite"));
  migrate(db);
  return db;
}

function offer(values) {
  return {
    issuer: "amex",
    cardName: "",
    cardLast4: "",
    merchant: "Example",
    category: "shopping",
    rewardType: "fixed_cash",
    rewardValue: 10,
    rewardText: "Spend $50, get $10 back",
    expiresOn: "2099-12-31",
    activationRequired: true,
    activated: false,
    sourceText: "public test offer",
    sourceUrl: null,
    ...values,
  };
}

async function withPublicDistribution(fn) {
  const previous = process.env.CCM_DISTRIBUTION;
  process.env.CCM_DISTRIBUTION = "public";
  try {
    return await fn();
  } finally {
    if (previous == null) {
      delete process.env.CCM_DISTRIBUTION;
    } else {
      process.env.CCM_DISTRIBUTION = previous;
    }
  }
}
