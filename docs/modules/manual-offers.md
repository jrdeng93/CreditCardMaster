# Manual Targeted Offers

Some targeted bonuses arrive through email, mail, app notifications, account messages, or copied web page text. These may not appear in automatic refresh, but they are still useful at checkout.

## Add A Manual Offer

```bash
npm run add-offer -- --issuer amex --merchant "Local restaurant" --reward "Spend $50, get $10 back" --category dining --expires 2026-09-30 --activated true
```

## Paste An Offer

For copied email/app/web text, use paste parsing:

```bash
npm run paste-offer -- --issuer amex --text "Macy's
Spend $50 or more, earn $10 back
Expires 8/31/26
Terms apply"
```

From Discord:

```text
/pasteoffer issuer:amex text:<copied offer text>
```

Then ask through Discord:

```text
/offers query:local restaurant
```

## Intended Direction

The product should reduce user pain. Paste-to-offer parsing is the default direction:

1. User copies the full text from an email, app page, or bank page.
2. CreditCardMaster extracts merchant, reward, expiration, category, issuer, and activation state.
3. The parsed offer is saved into SQLite and becomes searchable from Discord.
