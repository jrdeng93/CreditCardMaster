# GitHub Release Checklist

Use this checklist before creating the first public GitHub repository.

## Include

- `README.md`
- `README.zh-CN.md`
- `.env.example`
- `.gitignore`
- `package.json`
- `package-lock.json`
- `LICENSE`
- `CONTRIBUTING.md`
- `.github/ISSUE_TEMPLATE/`
- `src/`
- `test/`
- Only public-safe tests should be included. Private wallet/regression tests are ignored by `.gitignore`.
- `docs/`
- `docs/screenshots/*.svg`
- `data/category-taxonomy.json`
- `data/merchant-aliases.json`
- `data/card-benefits.public.json`
- `data/wallet-strategy.public.json`

## Exclude

- `.env`
- `node_modules/`
- `state/`
- `data/*.sqlite*`
- `data/*current*.json`
- `data/amex-*.json`
- `data/chase-*.json`
- `data/citi-*.json`
- `data/card-benefits.json`
- `data/query-evals.json`
- `data/wallet-strategy.json`
- `src/import-chase-offers.mjs`
- `src/import-citi-offers.mjs`
- `test/evals.test.mjs`
- `test/refresh.test.mjs`
- `test/regression.test.mjs`

## Required Checks

```bash
npm run public:check
npm run test:public
CCM_DISTRIBUTION=public npm run ask "macy's"
CCM_DISTRIBUTION=public npm run ask "今晚吃饭"
```

`public:check` can show warnings in a private working tree. That is acceptable only when those files are ignored and not added to the public repository.

## Manual Decisions

- Decide whether GitHub Issues should accept bank-specific automation requests. A good default is to keep bank login/browser automation out of the public edition.
- Do not publish screenshots containing real offers, card last four digits, Discord IDs, or webhook URLs.
