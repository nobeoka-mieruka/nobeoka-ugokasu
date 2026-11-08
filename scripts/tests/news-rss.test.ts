// お知らせのRSS（functions/rss.xml.ts・server/newsRss.ts）のテストです。
// D1はNode標準のSQLite（node:sqlite）で、静的ファイル（ビルド済みの /rss.xml・/news/file-items.json）はメモリ上で再現します。
// 実際のCloudflareへは一切アクセスしません。
//
// 実行: npm run test:news-rss

import assert from "node:assert/strict";
import { FakeD1 } from "./helpers/fakeD1";
import { createNewsItem, listPublicNews, resetNewsSchemaCache, setNewsPublished } from "../../server/newsItems";
import { renderNewsRss, absoluteLink } from "../../server/newsRss";
import { onRequestGet as rssGet } from "../../functions/rss.xml";
import { mergeNews, renderHomeNews, renderNewsList } from "../../src/utils/newsCards";
import { todayInJapan } from "../../src/utils/dialogueEvents";
import type { NewsDisplayItem } from "../../src/types/news";
import { siteConfig } from "../../src/config/siteConfig";

const realError = console.error;
const errors: string[] = [];
console.error = (...args: unknown[]) => errors.push(args.map(String).join(" "));
const realLog = console.log;
console.log = (...args: unknown[]) => {
  if (!String(args[0]).startsWith("{")) realLog(...args);
};

let passed = 0;
async function test(name: string, fn: () => Promise<void> | void) {
  resetNewsSchemaCache();
  await fn();
  passed++;
  realLog(`✓ ${name}`);
}

const SITE = "https://nobeoka-ugokasu.pages.dev";
const TODAY = todayInJapan();
const STATIC_RSS = `<?xml version="1.0" encoding="UTF-8"?><rss version="2.0"><channel><title>静的なRSS</title></channel></rss>`;

const FILE_ITEMS: NewsDisplayItem[] = [
  { key: "article:2026-11-08-voice-post-always-open", date: "2026-11-08", title: "みんなの声ポスト", summary: "常時募集", category: "サイト更新", href: "/news/2026-11-08-voice-post-always-open/", displayOrder: 0 },
  { key: "article:2026-11-08-welfare-dialogue-sessions", date: "2026-11-08", title: "意見交換会", summary: "全3回", category: "開催案内", href: "/news/2026-11-08-welfare-dialogue-sessions/", displayOrder: 0 },
  { key: "article:2026-07-17-official-site-launch", date: "2026-07-17", title: "公式サイト公開", summary: "公開しました", category: "サイト更新", href: "/news/2026-07-17-official-site-launch/", displayOrder: 0 },
  { key: "social:fb_1", date: "2026-10-01", title: "SNSの活動報告", summary: "看板", category: "活動報告", href: "https://www.facebook.com/p/1", displayOrder: 0 },
  // 掲載日前のファイル由来のお知らせは出さない
  { key: "article:2099-01-01-future", date: "2099-01-01", title: "未来の記事", summary: "予約", category: "お知らせ", href: "/news/2099-01-01-future/", displayOrder: 0 },
];

class FakeAssets {
  failing = new Set<string>();
  fileItems: unknown = { items: FILE_ITEMS };
  fetch = async (input: Request | URL | string) => {
    const url = new URL(input instanceof Request ? input.url : input.toString());
    if (this.failing.has(url.pathname)) return new Response("error", { status: 503 });
    if (url.pathname === "/rss.xml")
      return new Response(STATIC_RSS, {
        status: 200,
        headers: { "Content-Type": "application/rss+xml; charset=utf-8", "X-Content-Type-Options": "nosniff", ETag: '"abc"', "Content-Length": String(STATIC_RSS.length) },
      });
    if (url.pathname === "/news/file-items.json") return new Response(JSON.stringify(this.fileItems), { status: 200 });
    return new Response("not found", { status: 404 });
  };
}

async function setup() {
  const db = new FakeD1() as unknown as D1Database;
  const add = (title: string, publishedOn: string, extra: Partial<{ linkUrl: string; isPublished: boolean; displayOrder: number }> = {}) =>
    createNewsItem(
      db,
      { publishedOn, category: "notice", title, summary: `${title}の概要`, linkUrl: extra.linkUrl ?? "", isPublished: extra.isPublished ?? true, displayOrder: extra.displayOrder ?? 0 },
      "test@example.com",
    );
  await add("ポータルのお知らせ（リンクなし）", "2026-11-05");
  await add("ポータルのお知らせ（サイト内リンク）", "2026-10-20", { linkUrl: "/dialogue/" });
  await add("ポータルの下書き", "2026-11-06", { isPublished: false });
  await add("ポータルの予約掲載", "2099-12-31");
  await add("先頭に固定 <特集> & \"記号\"", "2026-09-01", { displayOrder: -1, linkUrl: "https://example.com/a?b=1&c=2" });
  const unpublished = await add("公開後に非公開へ戻したお知らせ", "2026-11-07");
  await setNewsPublished(db, unpublished!.id, false, "test@example.com");
  const assets = new FakeAssets();
  const env = { STAFF_DB: db, ASSETS: assets as unknown as Fetcher };
  const get = async (method = "GET") => {
    const res = await rssGet({ request: new Request(`${SITE}/rss.xml`, { method }), env } as never);
    return { res, text: await res.text() };
  };
  return { db, env, assets, get };
}

const titles = (xml: string) => [...xml.matchAll(/<item><title>([^<]*)<\/title>/g)].map((m) => m[1]);
const unescape = (s: string) => s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&");
const htmlTitles = (html: string) => [...html.matchAll(/<h3[^>]*>([^<]*)<\/h3>/g)].map((m) => unescape(m[1].replace(/&#39;/g, "'")));

await test("1. 記事ファイル（Markdown）とポータルで公開したお知らせの両方がRSSに載る", async () => {
  const { get } = await setup();
  const { res, text } = await get();
  assert.equal(res.status, 200);
  const list = titles(text).map(unescape);
  for (const title of ["みんなの声ポスト", "意見交換会", "SNSの活動報告", "公式ホームページを公開しました", "ポータルのお知らせ（リンクなし）", "ポータルのお知らせ（サイト内リンク）"]) {
    assert.ok(list.includes(title), `${title} がRSSに無い`);
  }
  // D1へ移行済みの記事（同じ移行元キーがD1にある）は、D1のお知らせとして1件だけ載る（/news/ と同じ）
  assert.ok(!list.includes("公式サイト公開"));
  assert.equal(list.filter((t) => t === "公式ホームページを公開しました").length, 1);
});

await test("2. 下書き・非公開に戻したお知らせ・掲載日前（予約）のお知らせはRSSに出ない", async () => {
  const { get } = await setup();
  const { text } = await get();
  for (const hidden of ["ポータルの下書き", "公開後に非公開へ戻したお知らせ", "ポータルの予約掲載", "未来の記事"]) assert.ok(!text.includes(hidden), `${hidden} がRSSに出ている`);
});

await test("3. 掲載順が /news/（一覧）・トップページ（先頭3件）と一致する", async () => {
  const { db, get } = await setup();
  const merged = mergeNews(await listPublicNews(db, TODAY), FILE_ITEMS, TODAY);
  const rss = titles((await get()).text).map(unescape);
  assert.deepEqual(rss, htmlTitles(renderNewsList(merged)), "/news/ と順番・件数が違う");
  assert.deepEqual(rss.slice(0, 3), htmlTitles(renderHomeNews(merged)).slice(0, 3), "トップページの先頭3件と違う");
  assert.equal(rss[0], '先頭に固定 <特集> & "記号"', "表示順（固定）が反映されていない");
});

await test("4. リンク：サイト内のパスは絶対URL、リンクなしは /news/、外部URLはそのまま（記号はXMLとしてエスケープ）", async () => {
  const { text } = await (await setup()).get();
  assert.ok(text.includes(`<link>${SITE}/news/2026-11-08-voice-post-always-open/</link>`));
  assert.ok(text.includes(`<link>${SITE}/dialogue/</link>`));
  assert.ok(text.includes(`<link>https://example.com/a?b=1&amp;c=2</link>`));
  assert.ok(text.includes("&lt;特集&gt; &amp; &quot;記号&quot;"));
  assert.equal(absoluteLink("", SITE), `${SITE}/news/`);
  assert.equal(absoluteLink("//evil.example/x", SITE), `${SITE}/news/`);
  assert.equal(absoluteLink("javascript:alert(1)", SITE), `${SITE}/news/`);
});

await test("5. 記事のguidは従来どおり記事URL（RSSリーダーで既読が新着に戻らない）。ポータルのお知らせは個別の識別子", async () => {
  const { text } = await (await setup()).get();
  assert.ok(text.includes(`<guid isPermaLink="true">${SITE}/news/2026-11-08-welfare-dialogue-sessions/</guid>`));
  const d1Guids = [...text.matchAll(/<guid isPermaLink="false">([^<]*)<\/guid>/g)].map((m) => m[1]);
  assert.ok(d1Guids.length >= 3 && new Set(d1Guids).size === d1Guids.length, "識別子が重複している");
  assert.ok(d1Guids.every((g) => /^https:\/\/nobeoka-ugokasu\.pages\.dev\/news\/#(d1|social):/.test(g)));
});

await test("5b. D1へ移行済みの記事も記事URLをguidにする。同じリンク先が2件ある場合は個別の識別子にする", async () => {
  const { text } = await (await setup()).get();
  assert.ok(text.includes(`<guid isPermaLink="true">${SITE}/news/2026-07-17-official-site-launch/</guid>`));
  const xml = renderNewsRss(
    [
      { key: "d1:1", date: "2026-11-01", title: "a", summary: "", category: "お知らせ", href: "/news/x/", displayOrder: 0 },
      { key: "article:x", date: "2026-11-01", title: "b", summary: "", category: "お知らせ", href: "/news/x/", displayOrder: 0 },
    ],
    SITE,
  );
  assert.ok(!xml.includes(`isPermaLink="true"`));
});

await test("6. 日付・形式：従来のRSSと同じ形式（RFC 822の日付、言語ja、RSS 2.0）", async () => {
  const { text } = await (await setup()).get();
  assert.ok(text.startsWith('<?xml version="1.0" encoding="UTF-8"?><rss version="2.0"><channel>'));
  assert.ok(text.includes("<pubDate>Sun, 08 Nov 2026 00:00:00 GMT</pubDate>"));
  assert.ok(text.includes("<language>ja</language>"));
  assert.ok(text.includes(`<title>${siteConfig.siteName}｜お知らせ</title>`), "静的なRSSと同じタイトル");
  assert.ok(text.includes(`<link>${siteConfig.siteUrl}/</link>`));
  assert.ok(text.endsWith("</channel></rss>"));
});

await test("7. ヘッダー：静的なRSSのヘッダー（nosniff等）を引き継ぎ、古いETag・Content-Lengthは付けない", async () => {
  const { res } = await (await setup()).get();
  assert.equal(res.headers.get("Content-Type"), "application/rss+xml; charset=utf-8");
  assert.equal(res.headers.get("X-Content-Type-Options"), "nosniff");
  assert.equal(res.headers.get("Cache-Control"), "public, max-age=0, must-revalidate");
  assert.equal(res.headers.get("ETag"), null);
  assert.equal(res.headers.get("Content-Length"), null);
});

await test("8. D1に障害があっても、公開済みの記事ファイルだけの静的なRSSを返す（エラー詳細は返さない）", async () => {
  const { env } = await setup();
  const broken = {
    ...env,
    STAFF_DB: {
      prepare: () => {
        throw new Error("D1_ERROR: database unavailable");
      },
      batch: async () => {
        throw new Error("D1_ERROR: database unavailable");
      },
    } as unknown as D1Database,
  };
  errors.length = 0;
  const res = await rssGet({ request: new Request(`${SITE}/rss.xml`), env: broken } as never);
  assert.equal(res.status, 200);
  assert.equal(await res.text(), STATIC_RSS);
  assert.ok(errors.some((e) => e.includes("news-rss-error")));
  const noDb = await rssGet({ request: new Request(`${SITE}/rss.xml`), env: { ASSETS: env.ASSETS } } as never);
  assert.equal(await noDb.text(), STATIC_RSS);
});

await test("9. 記事一覧（file-items.json）を読めない・壊れている場合も静的なRSSを返す", async () => {
  const { assets, get } = await setup();
  assets.failing.add("/news/file-items.json");
  assert.equal((await get()).text, STATIC_RSS);
  assets.failing.clear();
  assets.fileItems = { broken: true };
  assert.equal((await get()).text, STATIC_RSS);
});

await test("10. 静的なRSSが無い（404等）場合はそのまま返す。HEADは本文なし", async () => {
  const { assets, get } = await setup();
  const head = await get("HEAD");
  assert.equal(head.res.status, 200);
  assert.equal(head.text, "");
  assets.failing.add("/rss.xml");
  assert.equal((await get()).res.status, 503);
});

await test("11. お知らせが0件でも正しいRSSになる", () => {
  const xml = renderNewsRss([], SITE);
  assert.ok(xml.includes("<channel>") && !xml.includes("<item>"));
});

await test("12. 本文の制御文字はXMLから取り除く", () => {
  const xml = renderNewsRss([{ key: "d1:1", date: "2026-11-01", title: "a\u0001b", summary: "c\u000bd", category: "お知らせ", href: "", displayOrder: 0 }], SITE);
  assert.ok(xml.includes("<title>ab</title>") && xml.includes("<description>cd</description>"));
});

console.error = realError;
console.log = realLog;
console.log(`\n${passed}件のテストに合格しました。`);
