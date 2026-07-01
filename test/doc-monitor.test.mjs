import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { migrate, openDb } from "../src/db.mjs";
import {
  evaluateDoctorOfCreditArticles,
  formatDoctorOfCreditBriefing,
  formatDoctorOfCreditDigest,
  markDoctorOfCreditBriefingSent,
  notifyDoctorOfCreditDigest,
  parseCreditCardNewsFeed,
} from "../src/doc-monitor.mjs";

test("credit card news parser extracts RSS feed items", () => {
  const rss = `
    <rss><channel>
      <item>
        <title><![CDATA[American Express Adds Apple Pay Pay With Points]]></title>
        <link>https://www.doctorofcredit.com/amex-apple-pay/</link>
        <pubDate>Wed, 01 Jul 2026 12:00:00 +0000</pubDate>
        <category><![CDATA[Credit Cards]]></category>
        <slash:comments>1</slash:comments>
        <description><![CDATA[This body should not be copied into the digest.]]></description>
      </item>
      <item>
        <title><![CDATA[Amazon: Get 50% Off When Using Membership Rewards Points]]></title>
        <link>/amazon-membership-rewards/</link>
        <pubDate>Wed, 01 Jul 2026 13:00:00 +0000</pubDate>
        <category><![CDATA[Deals]]></category>
        <slash:comments>1364</slash:comments>
      </item>
    </channel></rss>
  `;

  const articles = parseCreditCardNewsFeed(rss, "https://www.doctorofcredit.com/");

  assert.equal(articles.length, 2);
  assert.equal(articles[0].title, "American Express Adds Apple Pay Pay With Points");
  assert.equal(articles[0].commentCount, 1);
  assert.equal(articles[0].category, "Credit Cards");
  assert.equal(articles[1].commentCount, 1364);
  assert.equal(articles[1].url, "https://www.doctorofcredit.com/amazon-membership-rewards/");
  assert.equal(articles[0].excerpt, undefined);
});

test("credit card news digest formats high comment discussions first", () => {
  const articles = parseCreditCardNewsFeed(`
    <rss><channel>
      <item><title>Low Comment Credit Card Post</title><link>/low/</link><pubDate>Wed, 01 Jul 2026 12:00:00 +0000</pubDate><category>Credit Cards</category><slash:comments>1</slash:comments></item>
      <item><title>Hot Deal</title><link>/hot/</link><pubDate>Wed, 01 Jul 2026 12:00:00 +0000</pubDate><category>Deals</category><slash:comments>900</slash:comments></item>
    </channel></rss>
  `, "https://www.doctorofcredit.com/");
  const message = formatDoctorOfCreditDigest({
    url: "https://www.doctorofcredit.com/",
    hot: articles.sort((a, b) => b.score - a.score),
  });

  assert.match(message, /^Credit Card News daily digest/);
  assert.match(message, /1\. Hot Deal/);
  assert.match(message, /900 comments/);
  assert.match(message, /Reasoning: hot discussion/);
  assert.doesNotMatch(message, /Big discussion/);
});

test("credit card news stateful monitor only sends new or heating-up items", () => {
  const db = setupDb();
  const articles = [
    article({ title: "Hot Deal", url: "https://www.doctorofcredit.com/hot/", category: "Deals", comments: 300 }),
    article({ title: "Low Credit Card News", url: "https://www.doctorofcredit.com/card/", category: "Credit Cards", comments: 6 }),
  ];

  const first = evaluateDoctorOfCreditArticles(db, articles, {
    now: "2026-07-01T12:00:00.000Z",
    minComments: 50,
    creditCardMinComments: 5,
    growthComments: 100,
  });
  assert.equal(first.sections.newHot.length, 1);
  assert.equal(first.sections.creditCardRelevant.length, 1);
  assert.match(formatDoctorOfCreditBriefing(first), /New hot:/);
  markDoctorOfCreditBriefingSent(db, first);

  const unchanged = evaluateDoctorOfCreditArticles(db, articles, {
    now: "2026-07-01T13:00:00.000Z",
    minComments: 50,
    creditCardMinComments: 5,
    growthComments: 100,
  });
  assert.equal(unchanged.sections.newHot.length, 0);
  assert.equal(unchanged.sections.heatingUp.length, 0);
  assert.equal(unchanged.sections.creditCardRelevant.length, 0);

  const heated = evaluateDoctorOfCreditArticles(db, [
    article({ title: "Hot Deal", url: "https://www.doctorofcredit.com/hot/", category: "Deals", comments: 425 }),
  ], {
    now: "2026-07-01T14:00:00.000Z",
    minComments: 50,
    creditCardMinComments: 5,
    growthComments: 100,
  });
  assert.equal(heated.sections.heatingUp.length, 1);
  assert.equal(heated.sections.heatingUp[0].commentDelta, 125);
});

test("credit card news notifier skips Discord when there are no new items", async () => {
  const db = setupDb();
  const first = evaluateDoctorOfCreditArticles(db, [
    article({ title: "Hot Deal", url: "https://www.doctorofcredit.com/hot/", category: "Deals", comments: 300 }),
  ], {
    now: "2026-07-01T12:00:00.000Z",
    minComments: 50,
  });
  markDoctorOfCreditBriefingSent(db, first);

  const result = await notifyDoctorOfCreditDigest(db, {
    articles: [
      article({ title: "Hot Deal", url: "https://www.doctorofcredit.com/hot/", category: "Deals", comments: 300 }),
    ],
    minComments: 50,
    now: "2026-07-01T13:00:00.000Z",
  });

  assert.equal(result.notification.sent, false);
  assert.equal(result.notification.reason, "no_new_items");
});

function setupDb() {
  const dir = mkdtempSync(join(tmpdir(), "ccm-doc-monitor-"));
  const db = openDb(join(dir, "offers.sqlite"));
  migrate(db);
  return db;
}

function article({ title, url, category, comments }) {
  return {
    title,
    url,
    category,
    commentCount: comments,
    dateText: "July 1, 2026",
    score: comments,
  };
}
