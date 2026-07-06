# Shopping Portals

CreditCardMaster can remind you to check a shopping portal before paying online.

The first built-in portal entry is Rakuten. The public edition does not scrape Rakuten, read account data, read cash-back rates, or click through automatically. It creates a store-page entry when the merchant is known, or a Rakuten domain lookup link when it is not, so you can verify the current portal rate yourself.

## Commands

```bash
npm run rakuten "macy's"
```

Discord:

```text
/rakuten query:macy's
```

Normal `/offers` and `/bestcard` results also include a Rakuten check for merchant and online-shopping categories.

## Configuration

```text
RAKUTEN_ENABLED=1
RAKUTEN_SEARCH_URL_TEMPLATE=https://www.rakuten.com/{domain}
```

Set `RAKUTEN_ENABLED=0` to hide portal checks.
