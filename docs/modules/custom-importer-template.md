# Custom Offer Importer Template

CreditCardMaster can support automatic offer import, but the public edition intentionally does not include bank-specific login, browser automation, or page scraping code for legal, terms-of-service, and maintenance reasons.

If you have data you are allowed to use, you can vibe-code a local importer that converts that data into CreditCardMaster's offer shape, then inserts it through the same path as manual offers.

## Offer Shape

Your importer should produce objects like this:

```js
{
  issuer: "amex",
  merchant: "Macy's",
  rewardText: "Spend $50 or more, earn $10 back",
  category: "department_store",
  expiresOn: "2026-08-31",
  cardName: "",
  cardLast4: "",
  activated: false,
  activationRequired: true,
  sourceText: "custom importer",
  sourceUrl: null
}
```

## Minimal Local Importer

Create a private local file outside the public repo, or keep it ignored by git:

```js
import { loadEnv } from "./src/config.mjs";
import { migrate, openDb, upsertOffer } from "./src/db.mjs";

loadEnv();

const db = openDb();
migrate(db);

const offers = [
  {
    issuer: "amex",
    merchant: "Macy's",
    rewardText: "Spend $50 or more, earn $10 back",
    category: "department_store",
    expiresOn: "2026-08-31",
    activated: false,
    activationRequired: true,
    sourceText: "custom importer",
  },
];

for (const offer of offers) {
  upsertOffer(db, {
    issuer: offer.issuer,
    merchant: offer.merchant,
    rewardText: offer.rewardText,
    category: offer.category,
    expiresOn: offer.expiresOn,
    cardName: offer.cardName || "",
    cardLast4: offer.cardLast4 || "",
    activated: Boolean(offer.activated),
    activationRequired: offer.activationRequired !== false,
    sourceText: offer.sourceText || "custom importer",
    sourceUrl: offer.sourceUrl || null,
  });
}

console.log(`Imported ${offers.length} offer(s).`);
```

## Guardrails

- Do not commit credentials, cookies, browser profiles, or bank session data.
- Do not publish bank-specific scraping code unless you have reviewed the legal and terms-of-service implications.
- Prefer user-provided files, CSV exports, pasted text, or APIs you are authorized to use.
- Keep private importers in ignored local files.
