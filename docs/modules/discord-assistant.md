# Discord Checkout Assistant

Discord is the intended daily interface for CreditCardMaster. The typical use case is mobile: you are about to pay, you ask the bot, and it checks local offers plus card benefits before you swipe.

## Commands

```text
/offers query:macy's
/offers query:restaurant
/offers query:gas
/offers query:今晚吃饭
```

Use `/offers` when you want to see matching offers plus a payment recommendation.

Use `/bestcard` when you only want the best card recommendation and do not want a related-offer list:

```text
/bestcard query:restaurant
/bestcard query:macy's
```

Other useful commands:

- `/addoffer`: add a targeted/manual offer.
- `/pasteoffer`: paste copied offer text and let CreditCardMaster parse it.
- `/expiring`: show offers expiring soon.
- `/watch`, `/unwatch`, `/watchlist`: manage merchants or categories you care about.
- `/bestcard query:<merchant or category>`: recommend which card to use.
- `/offerstatus`: show local database status.

## Setup

Required `.env` values:

```text
DISCORD_BOT_TOKEN=
DISCORD_CLIENT_ID=
DISCORD_GUILD_ID=
DISCORD_ALLOWED_USER_IDS=
```

Meaning:

- `DISCORD_BOT_TOKEN`: token from your Discord Developer Portal bot.
- `DISCORD_CLIENT_ID`: application/client ID for that bot.
- `DISCORD_GUILD_ID`: your Discord server ID.
- `DISCORD_ALLOWED_USER_IDS`: comma-separated Discord user IDs allowed to use the bot. Required; the bot refuses to start when this is empty.

All slash-command responses are ephemeral so personal offer, card, and wallet data is visible only to the user who ran the command.

Run the bot:

```bash
npm run bot
```

The CLI has local test commands, but normal users should interact through Discord.
