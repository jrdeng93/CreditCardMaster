# Shopping Portals

CreditCardMaster can remind you to check a shopping portal before paying online.

The first built-in portal entry is Rakuten. The public edition does not scrape Rakuten, read account data, or click through automatically. It only creates a search link so you can decide whether to use the portal.

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
RAKUTEN_SEARCH_URL_TEMPLATE=https://www.rakuten.com/stores/all?query={query}
```

Set `RAKUTEN_ENABLED=0` to hide portal checks.
