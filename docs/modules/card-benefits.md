# Card Benefits And Wallet Strategy

CreditCardMaster is not only an offer search box. It also models card-level benefits so the assistant can reason about cards even when there is no merchant offer.

## What The Engine Uses

- Merchant and category intent, such as dining, gas, travel, grocery, hotel, airline, or online shopping.
- Card-level credits and benefits.
- Bonus categories and temporary multipliers.
- Points and cashback reward types.
- A wallet strategy file for point valuations and "benefits-only" cards.
- Fallback card rules when no offer or stronger category benefit matches.

Public-safe data lives in:

```text
data/card-benefits.public.json
data/wallet-strategy.public.json
```

Private local data can live in:

```text
data/card-benefits.json
data/wallet-strategy.json
```

Private data is ignored by git.

## Local Test Commands

```bash
npm run ask "macy's"
npm run bestcard "macy's"
npm run ask "restaurant"
npm run wallet-strategy
```

Daily use should still go through Discord:

```text
/offers query:restaurant
/bestcard query:restaurant
```

## Fallback Card Configuration

Use `data/wallet-strategy.json` for your private local wallet. Public users can mirror the same shape in their own local file:

```json
{
  "pointsValueCents": {
    "cash": 1,
    "mr": 1.5
  },
  "defaultFallbackCard": "amex:Blue Business Plus Card:",
  "categoryFallbackCards": {
    "general_shopping": "amex:Blue Business Plus Card:",
    "gas": "amex:Blue Cash Preferred Card:"
  },
  "cardPriority": {},
  "monthlyCategoryStrategy": {}
}
```

Card keys use:

```text
issuer:Card Name:last4
```

Public demo cards have an empty `last4`, so their keys end with a trailing colon.

## Why This Matters

Many decisions are not pure keyword matching. Dining, gas, travel, grocery, and portal benefits all need category-level understanding. The engine should combine:

- active offers,
- base card benefits,
- points/cashback value,
- temporary bonus categories,
- and practical reasoning about when a card is actually worth using.
