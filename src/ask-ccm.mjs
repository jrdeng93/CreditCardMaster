import { askWithRecommendations, formatSearchWithRecommendations } from "./benefits.mjs";
import { getStatus } from "./db.mjs";
import { expiringOffers, formatOffers } from "./search.mjs";
import { buildPortalChecks, formatPortalCheck } from "./portals.mjs";
import { formatWalletStrategy, loadWalletStrategy } from "./wallet-strategy.mjs";
import { formatWatchlist, listWatchlist } from "./watchlist.mjs";
import { resolveLanguage, t } from "./i18n.mjs";

export async function askCCM(db, query, options = {}) {
  const route = routeAskCCM(query);
  const lang = resolveLanguage({ lang: options.lang || options.language, query });

  if (route.type === "expiring") {
    const days = route.days ?? options.days ?? 14;
    const rows = expiringOffers(db, days, { limit: options.limit ?? 8 });
    return {
      route,
      output: formatRoutedResponse({
        lang,
        title: lang === "zh" ? `未来 ${days} 天快过期的 offer` : `Offers expiring in ${days} days`,
        body: formatOffers(rows, { lang }),
      }),
    };
  }

  if (route.type === "portal") {
    const checks = buildPortalChecks({ merchant: route.query, rawQuery: query }, options);
    return {
      route,
      output: formatRoutedResponse({
        lang,
        title: lang === "zh" ? "购物返现入口" : "Shopping portal check",
        body: checks.length ? checks.map((check) => formatPortalCheck(check, lang)).join("\n") : t(lang, "noPortalCheck"),
      }),
    };
  }

  if (route.type === "wallet") {
    return {
      route,
      output: formatRoutedResponse({
        lang,
        title: lang === "zh" ? "钱包策略" : "Wallet strategy",
        body: formatWalletStrategy(loadWalletStrategy()),
      }),
    };
  }

  if (route.type === "watchlist") {
    return {
      route,
      output: formatRoutedResponse({
        lang,
        title: lang === "zh" ? "关注列表" : "Watchlist",
        body: formatWatchlist(listWatchlist(db)),
      }),
    };
  }

  if (route.type === "status") {
    return {
      route,
      output: formatRoutedResponse({
        lang,
        title: lang === "zh" ? "本地 offer 数据状态" : "Local offer status",
        body: formatStatus(getStatus(db), lang),
      }),
    };
  }

  const result = await askWithRecommendations(db, query, options);
  return {
    route,
    result,
    output: formatSearchWithRecommendations(result, { ...options, lang }),
  };
}

export function routeAskCCM(query) {
  const text = String(query || "").trim();
  const lower = text.toLowerCase();

  if (/\b(expiring|expires? soon|ending soon|about to expire)\b/.test(lower) || /快过期|即将过期|马上过期|快到期|要过期|到期/.test(text)) {
    return { type: "expiring", days: extractDays(text), query: text };
  }

  if (/\b(rakuten|portal|cash\s*back portal|shopping portal)\b/.test(lower) || /返现入口|购物入口|导购|门户/.test(text)) {
    return { type: "portal", query: stripRouteWords(text) };
  }

  if (/\b(wallet|strategy|point values?|points value)\b/.test(lower) || /钱包策略|积分估值|点数估值|持卡策略/.test(text)) {
    return { type: "wallet", query: text };
  }

  if (/\b(watchlist|watch list|watched)\b/.test(lower) || /关注列表|监控列表|watchlist/.test(text)) {
    return { type: "watchlist", query: text };
  }

  if (/\b(status|database|db|how many offers|offer status)\b/.test(lower) || /状态|数据库|多少.*offer|offer.*数量/.test(text)) {
    return { type: "status", query: text };
  }

  return { type: "checkout", query: text };
}

function formatRoutedResponse({ lang, title, body }) {
  return [
    `${t(lang, "ccmRoute")}: ${title}`,
    body,
  ].filter(Boolean).join("\n");
}

function formatStatus(status, lang = "en") {
  if (lang === "zh") {
    return [
      `总 offer 数: ${status.total}`,
      `最新更新时间: ${status.newest || "无"}`,
      "按 issuer:",
      ...status.byIssuer.map((row) => `- ${row.issuer}: ${row.count}`),
    ].join("\n");
  }

  return [
    `Total offers: ${status.total}`,
    `Newest update: ${status.newest || "none"}`,
    "By issuer:",
    ...status.byIssuer.map((row) => `- ${row.issuer}: ${row.count}`),
  ].join("\n");
}

function extractDays(text) {
  const match = String(text || "").match(/(\d{1,3})\s*(?:days?|天|日)/i);
  return match ? Number(match[1]) : null;
}

function stripRouteWords(text) {
  return String(text || "")
    .replace(/\b(rakuten|portal|cash\s*back portal|shopping portal|check|search)\b/gi, " ")
    .replace(/返现入口|购物入口|导购|门户|查一下|检查|搜索/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
