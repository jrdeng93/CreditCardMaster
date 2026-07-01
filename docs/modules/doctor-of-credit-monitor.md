# Credit Card News Monitor

CreditCardMaster can monitor a credit-card news RSS feed and send a daily Discord briefing for high-discussion posts.

The default source is Doctor of Credit's credit-card RSS feed:

```text
https://www.doctorofcredit.com/category/credit-cards/feed/
```

## Commands

Preview the digest locally:

```bash
npm run doc-monitor
```

Send a stateful briefing:

```bash
npm run doc-monitor-send
```

Check tracked discussion state:

```bash
npm run doc-monitor-status
```

## How It Works

- Reads RSS items from `DOC_MONITOR_URL`.
- Keeps title, URL, date, category, and comment count.
- Prioritizes high-comment and heating-up posts.
- Stores local state so unchanged items do not keep repeating.
- Sends new or newly-hot discussions to Discord.

## Recommended Cadence

Run this once each morning. Scheduling can be handled by your local scheduler, launchd, cron, or another supervisor.
