# Offer Import And Persistence

CreditCardMaster stores user-provided offers in local SQLite. Once an offer is added, it remains searchable until its expiration date.

## Public Edition

The public GitHub edition does not automate bank login, browser sessions, MFA, or bank-page scraping. Add offers manually, or build your own importer for data you are allowed to use.

## Add A Manual Offer

```bash
npm run add-offer -- \
  --issuer amex \
  --merchant "Macy's" \
  --reward "Spend $50 or more, earn $10 back" \
  --category department_store \
  --expires 2026-08-31
```

You can also add offers from Discord:

```text
/addoffer issuer:amex merchant:Macy's reward:Spend $50 or more, earn $10 back category:department_store expires:2026-08-31
```

## Search Later

```bash
npm run ask "macy's"
npm run bestcard "今晚吃饭"
```

The normal mobile workflow is Discord:

```text
/offers query:macy's
/bestcard query:restaurant
```

## Importer Guidance

Importers should accept user-provided files or pasted text. Keep credentials, cookies, browser profiles, and bank sessions outside the public project.

Local data paths such as `data/offers.sqlite` are ignored by git.
