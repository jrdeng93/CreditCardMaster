import { createHash } from "node:crypto";
import { loadEnv } from "./config.mjs";
import { migrate, openDb, upsertOffer } from "./db.mjs";
import { isIssuerEnabled } from "./distribution.mjs";

loadEnv();

const db = openDb();
migrate(db);

const samples = [
  {
    issuer: "amex",
    cardName: "Amex Gold",
    cardLast4: "1234",
    merchant: "Resy",
    category: "restaurant",
    rewardType: "fixed_cash",
    rewardValue: 15,
    rewardText: "Spend $75, get $15 back",
    minSpend: 75,
    maxReward: 15,
    expiresOn: "2026-08-31",
    activationRequired: true,
    activated: false,
  },
  {
    issuer: "chase",
    cardName: "Chase Sapphire Preferred",
    cardLast4: "5678",
    merchant: "Starbucks",
    category: "coffee",
    rewardType: "percent",
    rewardValue: 10,
    rewardText: "10% back, up to $6",
    maxReward: 6,
    expiresOn: "2026-07-22",
    activationRequired: true,
    activated: true,
  },
  {
    issuer: "citi",
    cardName: "Citi Premier",
    cardLast4: "9012",
    merchant: "DoorDash",
    category: "restaurant",
    rewardType: "percent",
    rewardValue: 5,
    rewardText: "5% back on eligible purchases",
    expiresOn: "2026-09-15",
    activationRequired: true,
    activated: false,
  },
  {
    issuer: "amex",
    cardName: "Blue Cash Preferred",
    cardLast4: "2468",
    merchant: "Whole Foods Market",
    category: "grocery",
    rewardType: "fixed_cash",
    rewardValue: 10,
    rewardText: "Spend $100, get $10 back",
    minSpend: 100,
    maxReward: 10,
    expiresOn: "2026-07-15",
    activationRequired: true,
    activated: false,
  },
];

const enabledSamples = samples.filter((offer) => isIssuerEnabled(offer.issuer));

for (const offer of enabledSamples) {
  const sourceText = `${offer.merchant} ${offer.rewardText} expires ${offer.expiresOn}`;
  upsertOffer(db, {
    ...offer,
    sourceText,
    sourceUrl: null,
    rawHash: createHash("sha256")
      .update(`${offer.issuer}:${offer.cardLast4}:${sourceText}`)
      .digest("hex"),
  });
}

console.log(`Seeded ${enabledSamples.length} sample offers.`);
