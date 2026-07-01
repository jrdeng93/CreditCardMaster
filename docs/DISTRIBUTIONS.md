# Distribution Strategy

CreditCardMaster should use one shared core with two distribution modes, not two divergent codebases.

## Public Edition

The public open-source edition supports Amex as the public issuer for card benefits and manual offers.

Included:

- Manual/user-provided Amex offers
- Local SQLite persistence
- Offer search and checkout recommendations
- Discord bot
- Watchlist, wallet strategy, credit-card news RSS digest, tests

Excluded for now:

- Bank login automation
- Browser-profile/session management
- Bank-page scraping
- Chase browser automation
- Citi browser automation
- User-specific private card snapshots
- Local browser profiles, logs, database files, and secrets

Use:

```text
CCM_DISTRIBUTION=public
```

## Private Edition

The private edition can enable additional locally maintained issuers and wallet data:

```text
CCM_DISTRIBUTION=private
```

This is the default when the variable is omitted so the existing local Mac setup keeps working.

## Guardrails

- Public Discord commands should only show Amex issuer choices for manual offers.
- Public releases should not expose bank browser automation scripts.
- Public manual offer creation should reject non-Amex issuers.
- `data/`, `state/`, and `.env` must stay out of git.
- Private adapters can stay in the working tree for local use, but should be excluded from the public export until they are ready to maintain.
