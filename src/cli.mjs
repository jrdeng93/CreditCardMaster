import { loadEnv } from "./config.mjs";
import { getStatus, migrate, openDb } from "./db.mjs";
import { askWithRecommendations, formatSearchWithRecommendations } from "./benefits.mjs";
import { expiringOffers, formatOffers, searchOffers } from "./search.mjs";
import { addManualOffer, addManualOfferFromText, formatManualOfferResult } from "./manual-offers.mjs";
import {
  addWatch,
  formatRemoveWatchResult,
  formatWatchResult,
  formatWatchlist,
  listWatchlist,
  removeWatch,
} from "./watchlist.mjs";
import {
  fetchDoctorOfCreditDigest,
  formatDoctorOfCreditDigest,
  formatDoctorOfCreditMonitorStatus,
  getDoctorOfCreditMonitorStatus,
  notifyDoctorOfCreditDigest,
} from "./doc-monitor.mjs";
import { formatWalletStrategy, loadWalletStrategy } from "./wallet-strategy.mjs";
import { dedupeOffers, formatDedupeOffersResult } from "./dedupe-offers.mjs";
import { formatSetupDoctor, runSetupDoctor } from "./setup-doctor.mjs";
import { buildPortalChecks, formatPortalCheck } from "./portals.mjs";

loadEnv();

const [, , command, ...args] = process.argv;
const db = openDb();
migrate(db);

if (command === "search") {
  const query = args.join(" ");
  console.log(formatOffers(searchOffers(db, query), { query }));
} else if (command === "ask") {
  const query = args.join(" ");
  console.log(formatSearchWithRecommendations(await askWithRecommendations(db, query)));
} else if (command === "bestcard") {
  const query = args.join(" ");
  console.log(formatSearchWithRecommendations(await askWithRecommendations(db, query), { showOffers: false }));
} else if (command === "rakuten") {
  const query = args.join(" ");
  const checks = buildPortalChecks({ merchant: query, rawQuery: query });
  console.log(checks.length ? checks.map((check) => formatPortalCheck(check)).join("\n") : "No Rakuten check for this query.");
} else if (command === "expiring") {
  const days = Number(args[0] || 14);
  console.log(formatOffers(expiringOffers(db, days)));
} else if (command === "add-offer") {
  console.log(formatManualOfferResult(addManualOffer(db, parseFlags(args))));
} else if (command === "paste-offer") {
  console.log(formatManualOfferResult(addManualOfferFromText(db, parseFlags(args))));
} else if (command === "watch") {
  console.log(formatWatchResult(addWatch(db, args.join(" "))));
} else if (command === "unwatch") {
  console.log(formatRemoveWatchResult(removeWatch(db, args.join(" "))));
} else if (command === "watchlist") {
  console.log(formatWatchlist(listWatchlist(db)));
} else if (command === "doc-monitor") {
  console.log(formatDoctorOfCreditDigest(await fetchDoctorOfCreditDigest(parseFlags(args))));
} else if (command === "doc-monitor-send") {
  const result = await notifyDoctorOfCreditDigest(db, parseFlags(args));
  console.log(JSON.stringify(result.notification, null, 2));
} else if (command === "doc-monitor-status") {
  console.log(formatDoctorOfCreditMonitorStatus(getDoctorOfCreditMonitorStatus(db, parseFlags(args))));
} else if (command === "wallet-strategy") {
  console.log(formatWalletStrategy(loadWalletStrategy()));
} else if (command === "doctor") {
  console.log(formatSetupDoctor(runSetupDoctor(db)));
} else if (command === "dedupe-offers") {
  console.log(formatDedupeOffersResult(dedupeOffers(db, parseFlags(args))));
} else if (command === "status") {
  const status = getStatus(db);
  console.log(JSON.stringify(status, null, 2));
} else {
  console.log("Usage: node src/cli.mjs <search|ask|bestcard|rakuten|expiring|add-offer|paste-offer|watch|unwatch|watchlist|doc-monitor|doc-monitor-send|doc-monitor-status|wallet-strategy|doctor|dedupe-offers|status> [query]");
  process.exitCode = 1;
}

function parseFlags(args) {
  const values = {};
  for (let index = 0; index < args.length; index += 1) {
    const key = args[index];
    if (!key.startsWith("--")) continue;

    const name = key.slice(2).replace(/-([a-z])/g, (_, char) => char.toUpperCase());
    const next = args[index + 1];
    if (next == null || next.startsWith("--")) {
      values[name] = true;
      continue;
    }
    values[name] = parseFlagValue(next);
    index += 1;
  }

  if (values.reward) values.rewardText = values.reward;
  if (values.expires) values.expiresOn = values.expires;
  return values;
}

function parseFlagValue(value) {
  if (value === "true") return true;
  if (value === "false") return false;
  return value;
}
