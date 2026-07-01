# Contributing

Thanks for improving CreditCardMaster.

## Scope

The public edition currently maintains Amex offer refresh. The core decision engine is broader and can support card benefits, wallet strategy, manual offers, Doctor of Credit monitoring, and future issuer adapters.

Good first contribution areas:

- README and onboarding polish
- Amex parser robustness
- Manual offer parsing
- Card benefit data improvements
- Search and recommendation quality
- Doctor of Credit briefing quality
- Tests for public behavior

## Safety

Do not include:

- Bank passwords, MFA codes, cookies, or session data
- Real card numbers or real account IDs
- Discord bot tokens or webhook URLs
- Screenshots with private account data
- Local database files, browser profiles, logs, or snapshots

Run before opening a pull request:

```bash
npm run public:check
npm run test:public
```

## Issuer Adapters

New issuer support is welcome, but it needs a maintainable plan:

- no password storage,
- no MFA bypass,
- clear public/private distribution boundary,
- parser tests with public-safe fixtures,
- and documentation for expected login/session behavior.
