# Python Runtime

CreditCardMaster now has two local runtimes under `src/`:

| Runtime | Entry point | Role |
| --- | --- | --- |
| JavaScript | `src/cli.mjs` | Primary Discord/local assistant runtime |
| Python | `src/ccm_py_cli.py` | Local CLI assistant runtime sharing the same SQLite and JSON data |

The Python runtime is intentionally local-first and mirrors the safe public boundary of the JavaScript runtime. It does not implement bank login automation, browser session handling, cookies, passwords, MFA workflows, bank-page scraping, Discord secrets, or portal account scraping.

## Commands

```bash
npm run ask -- "visible"
npm run ask:py -- "visible"

npm run search -- "dining"
npm run search:py -- "dining"

npm run bestcard -- "今晚吃饭用什么卡"
npm run bestcard:py -- "今晚吃饭用什么卡"
```

The Python CLI also supports:

```bash
python3 src/ccm_py_cli.py rakuten lululemom
python3 src/ccm_py_cli.py expiring 14
python3 src/ccm_py_cli.py status
```

## Shared Data

Both runtimes read the same local-safe project data:

- `data/offers.sqlite`
- `data/merchant-aliases.json`
- `data/category-taxonomy.json`
- `data/card-benefits.json` or `data/card-benefits.public.json`
- `data/wallet-strategy.json` or `data/wallet-strategy.public.json`

`CCM_DISTRIBUTION=public` keeps Python offer search to public issuers, matching JavaScript behavior.

## Current Coverage

Python v0.1 covers:

- `ask` routing for checkout, expiring offers, Rakuten portal checks, wallet strategy, and status.
- deterministic intent parsing and merchant/category canonicalization.
- active/expired offer search with public/private issuer filtering.
- card benefit recommendation and wallet strategy adjustment.
- best-choice selection, including amount-based offer minimum spend checks.
- optional RAG enrichment through the existing local `scripts/ccm_rag.py` bridge.

JavaScript remains the fuller runtime for Discord slash commands, manual offer import, RSS monitoring, and operational tooling.
