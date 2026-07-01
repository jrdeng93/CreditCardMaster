import { sendWebhook } from "./notify.mjs";

const DEFAULT_URL = "https://www.doctorofcredit.com/category/credit-cards/feed/";
const DEFAULT_LIMIT = 8;
const DEFAULT_MIN_COMMENTS = 20;
const DEFAULT_CREDIT_CARD_MIN_COMMENTS = 5;
const DEFAULT_GROWTH_COMMENTS = 100;

export async function fetchDoctorOfCreditDigest(options = {}) {
  const url = options.url || process.env.DOC_MONITOR_URL || DEFAULT_URL;
  const rss = await fetchRss(url);
  const articles = parseCreditCardNewsFeed(rss, url);
  const limit = Number(options.limit || process.env.DOC_MONITOR_LIMIT || DEFAULT_LIMIT);
  const minComments = Number(options.minComments || process.env.DOC_MONITOR_MIN_COMMENTS || DEFAULT_MIN_COMMENTS);
  const hot = rankArticles(articles)
    .filter((article) => article.commentCount >= minComments || article.category === "Credit Cards")
    .slice(0, limit);

  return {
    source: "Credit Card News",
    url,
    fetchedAt: new Date().toISOString(),
    articles,
    hot,
  };
}

export async function notifyDoctorOfCreditDigest(db, options = {}) {
  const briefing = await buildDoctorOfCreditBriefing(db, options);
  const message = formatDoctorOfCreditBriefing(briefing);
  if (!hasBriefingItems(briefing)) {
    return { briefing, message, notification: { sent: false, reason: "no_new_items" } };
  }
  const result = await sendWebhook(message, options);
  if (result.sent) markDoctorOfCreditBriefingSent(db, briefing);
  return { briefing, message, notification: result };
}

export function formatDoctorOfCreditDigest(digest) {
  const rows = digest.hot || [];
  if (!rows.length) {
    return [
      "Credit Card News daily digest",
      "No high-heat posts found today.",
      digest.url,
    ].join("\n");
  }

  return [
    "Credit Card News daily digest",
    ...rows.map((article, index) => formatArticle(article, index + 1)),
  ].join("\n\n");
}

export async function buildDoctorOfCreditBriefing(db, options = {}) {
  if (options.articles) return evaluateDoctorOfCreditArticles(db, options.articles, options);
  const digest = await fetchDoctorOfCreditDigest(options);
  return evaluateDoctorOfCreditArticles(db, digest.articles, { ...options, digest });
}

export function evaluateDoctorOfCreditArticles(db, articles, options = {}) {
  const digest = options.digest || {
    source: "Credit Card News",
    url: options.url || process.env.DOC_MONITOR_URL || DEFAULT_URL,
    fetchedAt: options.now || new Date().toISOString(),
    articles,
  };
  const now = options.now || new Date().toISOString();
  const thresholds = monitorThresholds(options);
  const seen = loadMonitorItems(db);
  const sections = {
    newHot: [],
    heatingUp: [],
    creditCardRelevant: [],
  };

  for (const article of rankArticles(articles)) {
    const previous = seen.get(article.url) || null;
    const evaluated = evaluateArticle(article, previous, thresholds);
    upsertMonitorItem(db, article, now);
    if (!evaluated) continue;

    if (evaluated.type === "new_hot") sections.newHot.push(evaluated);
    if (evaluated.type === "heating_up") sections.heatingUp.push(evaluated);
    if (evaluated.type === "credit_card_relevant") sections.creditCardRelevant.push(evaluated);
  }

  return {
    ...digest,
    fetchedAt: now,
    thresholds,
    sections: {
      newHot: sections.newHot.slice(0, thresholds.limit),
      heatingUp: sections.heatingUp.slice(0, thresholds.limit),
      creditCardRelevant: sections.creditCardRelevant.slice(0, thresholds.limit),
    },
  };
}

export function formatDoctorOfCreditBriefing(briefing) {
  const sections = briefing.sections || {};
  const rows = [
    ["New hot", sections.newHot || []],
    ["Heating up", sections.heatingUp || []],
    ["Credit card relevant", sections.creditCardRelevant || []],
  ].filter(([, items]) => items.length);

  if (!rows.length) {
    return [
      "Credit Card News Briefing",
      "No new hot or heating-up discussions since the last run.",
      briefing.url,
    ].join("\n");
  }

  return [
    "Credit Card News Briefing",
    ...rows.flatMap(([title, items]) => [
      "",
      `${title}:`,
      ...items.map((item, index) => formatBriefingItem(item, index + 1)),
    ]),
  ].join("\n");
}

export function getDoctorOfCreditMonitorStatus(db, options = {}) {
  const limit = Number(options.limit || 12);
  return db
    .prepare(
      `SELECT url, title, category, last_comment_count AS lastCommentCount,
              last_sent_comment_count AS lastSentCommentCount,
              first_seen_at AS firstSeenAt, last_seen_at AS lastSeenAt, last_sent_at AS lastSentAt
       FROM doc_monitor_items
       ORDER BY datetime(COALESCE(last_sent_at, last_seen_at)) DESC, last_comment_count DESC
       LIMIT @limit`,
    )
    .all({ limit });
}

export function formatDoctorOfCreditMonitorStatus(rows) {
  if (!rows.length) return "Credit card news monitor has no tracked items yet.";
  return rows
    .map((row, index) => {
      const sent = row.lastSentAt ? `sent ${row.lastSentAt.slice(0, 10)}` : "not sent";
      return `${index + 1}. ${row.title}\n${row.lastCommentCount.toLocaleString()} comments | ${row.category || "uncategorized"} | ${sent}\n${row.url}`;
    })
    .join("\n\n");
}

export function parseCreditCardNewsFeed(xml, baseUrl = DEFAULT_URL) {
  const text = String(xml || "");
  const itemRegex = /<item\b[^>]*>([\s\S]*?)<\/item>/gi;
  const articles = [];
  let match;

  while ((match = itemRegex.exec(text))) {
    const item = match[1];
    const title = decodeEntities(stripCdata(readTag(item, "title"))).trim();
    if (!title) continue;

    const rawUrl = stripCdata(readTag(item, "link")).trim();
    const dateText = stripCdata(readTag(item, "pubDate")).trim() || null;
    const category = decodeEntities(stripCdata(readTag(item, "category"))).trim() || null;
    const commentCount = parseCommentCount(item);

    articles.push({
      title,
      url: new URL(rawUrl, baseUrl).toString(),
      dateText,
      commentCount,
      category,
      score: scoreArticle({ commentCount, dateText, category }),
    });
  }

  return articles;
}

function rankArticles(articles) {
  return [...articles].sort((a, b) => b.score - a.score || b.commentCount - a.commentCount || a.title.localeCompare(b.title));
}

function monitorThresholds(options = {}) {
  return {
    limit: Number(options.limit || process.env.DOC_MONITOR_LIMIT || DEFAULT_LIMIT),
    minComments: Number(options.minComments || process.env.DOC_MONITOR_MIN_COMMENTS || DEFAULT_MIN_COMMENTS),
    creditCardMinComments: Number(
      options.creditCardMinComments ||
      process.env.DOC_MONITOR_CREDIT_CARD_MIN_COMMENTS ||
      DEFAULT_CREDIT_CARD_MIN_COMMENTS,
    ),
    growthComments: Number(
      options.growthComments ||
      process.env.DOC_MONITOR_GROWTH_COMMENTS ||
      DEFAULT_GROWTH_COMMENTS,
    ),
  };
}

function evaluateArticle(article, previous, thresholds) {
  const isCreditCard = article.category === "Credit Cards";
  const commentDelta = previous ? article.commentCount - Number(previous.lastCommentCount || 0) : article.commentCount;
  const alreadySent = Boolean(previous?.lastSentAt);

  if (!previous && article.commentCount >= thresholds.minComments) {
    return { type: "new_hot", article, commentDelta, reason: "new high-discussion thread" };
  }
  if (!previous && isCreditCard && article.commentCount >= thresholds.creditCardMinComments) {
    return { type: "credit_card_relevant", article, commentDelta, reason: "new credit-card relevant thread" };
  }
  if (previous && alreadySent && commentDelta >= thresholds.growthComments) {
    return { type: "heating_up", article, commentDelta, reason: `+${commentDelta.toLocaleString()} comments since last seen` };
  }
  if (previous && !alreadySent && article.commentCount >= thresholds.minComments) {
    return { type: "new_hot", article, commentDelta, reason: "high-discussion thread not previously sent" };
  }
  if (previous && !alreadySent && isCreditCard && article.commentCount >= thresholds.creditCardMinComments) {
    return { type: "credit_card_relevant", article, commentDelta, reason: "credit-card relevant thread not previously sent" };
  }
  return null;
}

function loadMonitorItems(db) {
  const rows = db
    .prepare(
      `SELECT url, title, category, first_seen_at AS firstSeenAt, last_seen_at AS lastSeenAt,
              last_comment_count AS lastCommentCount, last_sent_at AS lastSentAt,
              last_sent_comment_count AS lastSentCommentCount
       FROM doc_monitor_items`,
    )
    .all();
  return new Map(rows.map((row) => [row.url, row]));
}

function upsertMonitorItem(db, article, now) {
  db.prepare(
    `INSERT INTO doc_monitor_items (url, title, category, first_seen_at, last_seen_at, last_comment_count)
     VALUES (@url, @title, @category, @now, @now, @commentCount)
     ON CONFLICT(url) DO UPDATE SET
       title = excluded.title,
       category = excluded.category,
       last_seen_at = excluded.last_seen_at,
       last_comment_count = excluded.last_comment_count`,
  ).run({
    url: article.url,
    title: article.title,
    category: article.category,
    commentCount: article.commentCount,
    now,
  });
}

export function markDoctorOfCreditBriefingSent(db, briefing) {
  const now = new Date().toISOString();
  const items = [
    ...(briefing.sections?.newHot || []),
    ...(briefing.sections?.heatingUp || []),
    ...(briefing.sections?.creditCardRelevant || []),
  ];
  const stmt = db.prepare(
    `UPDATE doc_monitor_items
     SET last_sent_at = @now,
         last_sent_comment_count = @commentCount
     WHERE url = @url`,
  );
  for (const item of items) {
    stmt.run({
      url: item.article.url,
      commentCount: item.article.commentCount,
      now,
    });
  }
}

function formatBriefingItem(item, index) {
  const article = item.article;
  const meta = [
    article.commentCount ? `${article.commentCount.toLocaleString()} comments` : "0 comments",
    item.commentDelta > 0 ? `+${item.commentDelta.toLocaleString()}` : null,
    article.category,
    article.dateText,
  ].filter(Boolean).join(" | ");
  return [
    `${index}. ${article.title}`,
    meta,
    `Reasoning: ${item.reason}`,
    article.url,
  ].join("\n");
}

function hasBriefingItems(briefing) {
  return Boolean(
    briefing.sections?.newHot?.length ||
    briefing.sections?.heatingUp?.length ||
    briefing.sections?.creditCardRelevant?.length,
  );
}

function scoreArticle(article) {
  const commentScore = Math.log10(Math.max(article.commentCount, 0) + 1) * 100;
  const creditCardBonus = article.category === "Credit Cards" ? 25 : 0;
  const freshnessBonus = isTodayish(article.dateText) ? 15 : 0;
  return Math.round(commentScore + creditCardBonus + freshnessBonus);
}

async function fetchRss(url) {
  const response = await fetch(url, {
    headers: {
      "user-agent": "CreditCardMaster/0.1 (+local personal monitor)",
      accept: "application/rss+xml, application/xml, text/xml",
    },
  });
  if (!response.ok) throw new Error(`Credit card news feed HTTP ${response.status}`);
  return response.text();
}

function parseCommentCount(xml) {
  const value = readTag(xml, "slash:comments") || readTag(xml, "comments");
  const match = String(value || "").match(/([\d,]+)/i);
  return match ? Number(match[1].replaceAll(",", "")) : 0;
}

function formatArticle(article, index) {
  const meta = [
    article.commentCount ? `${article.commentCount.toLocaleString()} comments` : "0 comments",
    article.category,
    article.dateText,
  ].filter(Boolean).join(" | ");
  return [
    `${index}. ${article.title}`,
    meta,
    `Reasoning: hot discussion${article.category ? ` in ${article.category}` : ""}.`,
    article.url,
  ].join("\n");
}

function isTodayish(dateText) {
  if (!dateText) return false;
  const date = new Date(dateText);
  if (Number.isNaN(date.getTime())) return false;
  const ageMs = Date.now() - date.getTime();
  return ageMs >= -24 * 60 * 60 * 1000 && ageMs <= 36 * 60 * 60 * 1000;
}

function readTag(xml, tagName) {
  const escaped = tagName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = String(xml || "").match(new RegExp(`<${escaped}\\b[^>]*>([\\s\\S]*?)<\\/${escaped}>`, "i"));
  return match ? match[1] : "";
}

function stripCdata(value) {
  return String(value || "").replace(/^<!\[CDATA\[/, "").replace(/\]\]>$/, "");
}

function decodeEntities(value) {
  return String(value || "")
    .replace(/&#8216;|&lsquo;|&#8217;|&rsquo;/g, "'")
    .replace(/&#8211;|&ndash;/g, "-")
    .replace(/&#038;|&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/&nbsp;/g, " ");
}
