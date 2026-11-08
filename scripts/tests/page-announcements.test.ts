// 新しいページの公開検知（server/pageAnnouncements.ts・/api/admin/detect-new-pages）のテストです。
// D1はNode標準のSQLite（node:sqlite）で、公開中のサイトはメモリ上のファイルで再現します。
// 実際のCloudflare・GitHubへは一切アクセスしません。
//
// 実行: npm run test:page-announcements

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { FakeD1 } from "./helpers/fakeD1";
import { PUBLIC_PAGES_SCHEMA_SQL, detectNewPages, resetPublicPagesSchemaCache, MAX_NEW_PAGES_PER_RUN } from "../../server/pageAnnouncements";
import { createNewsItem, listNewsItems, listPublicNews, resetNewsSchemaCache, setNewsPublished } from "../../server/newsItems";
import { onRequest as detectApi } from "../../functions/api/admin/detect-new-pages";

const logLines: string[] = [];
const realLog = console.log;
const realError = console.error;
console.log = (...args: unknown[]) => {
  const line = args.map(String).join(" ");
  if (line.startsWith("{")) logLines.push(line);
  else realLog(...args);
};
console.error = (...args: unknown[]) => logLines.push(args.map(String).join(" "));

let passed = 0;
async function test(name: string, fn: () => Promise<void>) {
  resetNewsSchemaCache();
  resetPublicPagesSchemaCache();
  await fn();
  passed++;
  realLog(`✓ ${name}`);
}

const ORIGIN = "https://nobeoka-ugokasu.pages.dev";
const TODAY = "2026-11-08";
const COMMIT = "438cc0e0000000000000000000000000000000aa";
const SECRET = "test-detect-secret-value";

const page = (title: string, description: string, robots = "index, follow") =>
  `<!doctype html><html><head><title>${title}｜福富千恵と延岡を動かす会</title><meta name="description" content="${description}"><meta name="robots" content="${robots}"></head><body></body></html>`;

/** 公開中のサイト（静的ファイル）を再現する */
class FakeSite {
  files = new Map<string, string>();
  failing = new Set<string>();
  fetched: string[] = [];
  constructor(paths: string[], commit = COMMIT) {
    this.setPages(paths);
    this.files.set("/build-version.json", JSON.stringify({ commitSha: commit }));
    this.files.set("/news/file-items.json", JSON.stringify({ items: [{ href: "/news/2026-11-08-voice-post-always-open/" }] }));
  }
  setPages(paths: string[]) {
    this.files.set("/sitemap-index.xml", `<sitemapindex><sitemap><loc>${ORIGIN}/sitemap-0.xml</loc></sitemap></sitemapindex>`);
    this.files.set("/sitemap-0.xml", `<urlset>${paths.map((p) => `<url><loc>${ORIGIN}${p}</loc></url>`).join("")}</urlset>`);
    for (const p of paths) if (!this.files.has(p)) this.files.set(p, page(`ページ${p}`, `${p}の説明です。`));
  }
  fetchAsset = async (path: string) => {
    this.fetched.push(path);
    if (this.failing.has(path)) return new Response("error", { status: 503 });
    const body = this.files.get(path);
    return body === undefined ? new Response("not found", { status: 404 }) : new Response(body, { status: 200 });
  };
}

const EXISTING = ["/", "/profile/", "/voices/", "/voice-post/", "/dialogue/", "/news/", "/news/2026-11-08-voice-post-always-open/"];
const run = (db: FakeD1, site: FakeSite, extra: Partial<Parameters<typeof detectNewPages>[1]> = {}) =>
  detectNewPages(db as unknown as D1Database, { fetchAsset: site.fetchAsset, today: TODAY, ...extra });
const drafts = async (db: FakeD1) => (await listNewsItems(db as unknown as D1Database)).filter((i) => i.sourceKey?.startsWith("page:"));
const recorded = async (db: FakeD1) =>
  ((await db.prepare("SELECT path FROM public_pages ORDER BY path").all<{ path: string }>()).results ?? []).map((r) => r.path);

/** 初回（記録が空）の検知を済ませたD1とサイト */
async function baselined() {
  const db = new FakeD1();
  const site = new FakeSite(EXISTING);
  assert.equal((await run(db, site)).status, "baseline");
  return { db, site };
}

await test("1. 初回は今あるページを記録するだけで、お知らせは作らない（トップ・お知らせ記事は対象外）", async () => {
  const { db } = await baselined();
  assert.deepEqual(await recorded(db), ["/dialogue/", "/profile/", "/voice-post/", "/voices/"]);
  assert.equal((await drafts(db)).length, 0);
});

await test("2. 新しいページが公開されると、確認待ちの下書き（非公開）が1件できる", async () => {
  const { db, site } = await baselined();
  site.setPages([...EXISTING, "/stamp-rally/"]);
  site.files.set("/stamp-rally/", page("スタンプラリー", "市内を巡るスタンプラリーのご案内です。"));
  const result = await run(db, site);
  assert.equal(result.status, "ok");
  assert.deepEqual(result.drafted.map((d) => d.path), ["/stamp-rally/"]);
  const [draft] = await drafts(db);
  assert.equal(draft.sourceKey, "page:/stamp-rally/");
  assert.equal(draft.isPublished, false, "必ず非公開（下書き）");
  assert.equal(draft.publishedOn, TODAY, "掲載日は公開を確認した日");
  assert.equal(draft.title, "「スタンプラリー」のページを公開しました");
  assert.equal(draft.summary, "市内を巡るスタンプラリーのご案内です。");
  assert.equal(draft.linkUrl, "/stamp-rally/");
  assert.equal(draft.category, "notice");
  assert.equal(draft.createdBy, "system:page-detect", "処理履歴に作成者が残る");
  const audit = await db.prepare("SELECT action, actor_email FROM staff_audit_log").all<{ action: string; actor_email: string }>();
  assert.deepEqual(audit.results, [{ action: "news.create", actor_email: "system:page-detect" }], "操作ログに記録される");
});

await test("3. 未公開の下書きは一般の画面に出ず、執行部が公開した後にだけ出る", async () => {
  const { db, site } = await baselined();
  site.setPages([...EXISTING, "/activities/2026-11-10-cleanup/"]);
  await run(db, site);
  const before = await listPublicNews(db as unknown as D1Database, TODAY);
  assert.ok(!before.items.some((i) => i.href === "/activities/2026-11-10-cleanup/"), "下書きは公開ページに出ない");
  const [draft] = await drafts(db);
  assert.equal(draft.category, "activity_report", "活動報告のページは「活動報告」");
  await setNewsPublished(db as unknown as D1Database, draft.id, true, "staff@example.com");
  const after = await listPublicNews(db as unknown as D1Database, TODAY);
  assert.ok(after.items.some((i) => i.href === "/activities/2026-11-10-cleanup/" && i.category === "活動報告"), "承認後は表示される");
});

await test("4. 同じ検知を何度実行しても（Actionsの再実行も）、下書きは二重にできない", async () => {
  const { db, site } = await baselined();
  site.setPages([...EXISTING, "/new-page/"]);
  await run(db, site);
  const again = await run(db, site);
  assert.equal(again.drafted.length, 0);
  // 記録を消してしまった場合でも、お知らせ側の識別子（page:<パス>）で重複を防ぐ
  db.sqlite.exec("DELETE FROM public_pages WHERE path = '/new-page/'");
  const third = await run(db, site);
  assert.equal(third.drafted.length, 0);
  assert.equal((await drafts(db)).length, 1);
});

await test("5. 既存のお知らせ（D1・記事ファイル）がそのページへリンクしていれば、下書きを作らず要確認にする", async () => {
  const { db, site } = await baselined();
  await createNewsItem(db as unknown as D1Database, {
    publishedOn: TODAY, category: "notice", title: "手動のお知らせ", summary: "説明", linkUrl: "/manual/", isPublished: true, displayOrder: 0,
  }, "staff@example.com");
  site.files.set("/news/file-items.json", JSON.stringify({ items: [{ href: "/from-article/" }] }));
  site.setPages([...EXISTING, "/manual/", "/from-article/"]);
  const result = await run(db, site);
  assert.equal(result.drafted.length, 0);
  assert.deepEqual(result.needsReview.map((n) => n.path).sort(), ["/from-article/", "/manual/"]);
  assert.deepEqual(await recorded(db), ["/dialogue/", "/from-article/", "/manual/", "/profile/", "/voice-post/", "/voices/"]);
});

await test("6. 本番がまだ以前のコミット（デプロイ未完了・失敗）なら、何も読み書きしない", async () => {
  const db = new FakeD1();
  const site = new FakeSite([...EXISTING, "/new-page/"], "0000000old");
  const result = await run(db, site, { expectedCommit: COMMIT });
  assert.equal(result.status, "not_live");
  assert.deepEqual(site.fetched, ["/build-version.json"], "サイトマップも読まない");
  assert.equal(db.queries, 0, "D1にも触れない");
});

await test("7. 一度に多数のページが増えたら（URLの整理など）、下書きを作らず要確認。確認後は「記録のみ」で解消できる", async () => {
  const { db, site } = await baselined();
  const many = Array.from({ length: MAX_NEW_PAGES_PER_RUN + 1 }, (_, i) => `/moved/${i}/`);
  site.setPages([...EXISTING, ...many]);
  const result = await run(db, site);
  assert.equal(result.status, "too_many");
  assert.equal(result.needsReview.length, many.length);
  assert.equal((await drafts(db)).length, 0);
  assert.equal((await run(db, site)).status, "too_many", "記録しないため、確認されるまで毎回報告される");
  const resolved = await run(db, site, { recordOnly: true });
  assert.equal(resolved.status, "recorded");
  assert.equal((await run(db, site)).status, "ok");
  assert.equal((await drafts(db)).length, 0);
});

await test("8. サイトマップや記事一覧を読めない（通信障害など）ときは、何も作らず失敗として返す", async () => {
  const { db, site } = await baselined();
  site.setPages([...EXISTING, "/new-page/"]);
  site.failing.add("/sitemap-0.xml");
  await assert.rejects(run(db, site));
  site.failing.clear();
  site.failing.add("/news/file-items.json");
  await assert.rejects(run(db, site), /file_items_unavailable/, "重複を確かめられないので作らない");
  assert.equal((await drafts(db)).length, 0);
  assert.ok(!(await recorded(db)).includes("/new-page/"));
  site.failing.clear();
  assert.equal((await run(db, site)).drafted.length, 1, "復旧後の再実行で作られる");
});

await test("9. ページ単体を読めないときは要確認として残し、次回に再確認する", async () => {
  const { db, site } = await baselined();
  site.setPages([...EXISTING, "/new-page/"]);
  site.failing.add("/new-page/");
  const first = await run(db, site);
  assert.deepEqual(first.needsReview.map((n) => n.path), ["/new-page/"]);
  assert.ok(!(await recorded(db)).includes("/new-page/"));
  site.failing.clear();
  assert.deepEqual((await run(db, site)).drafted.map((d) => d.path), ["/new-page/"]);
});

await test("10. 検索除外（noindex）のページ・タイトルの無いページは下書きにしない", async () => {
  const { db, site } = await baselined();
  site.setPages([...EXISTING, "/hidden/", "/untitled/"]);
  site.files.set("/hidden/", page("準備中", "準備中です。", "noindex, nofollow"));
  site.files.set("/untitled/", "<html><head></head></html>");
  const result = await run(db, site);
  assert.equal(result.drafted.length, 0);
  assert.deepEqual(result.needsReview.map((n) => n.path).sort(), ["/hidden/", "/untitled/"]);
});

await test("11. 既存ページの文言やデザインを変えても（サイトマップが同じなら）、何も作らない", async () => {
  const { db, site } = await baselined();
  site.files.set("/profile/", page("プロフィール（誤字修正後）", "説明文を修正しました。"));
  const result = await run(db, site);
  assert.equal(result.status, "ok");
  assert.equal(result.drafted.length, 0);
  assert.equal(result.needsReview.length, 0);
});

// ---- エンドポイント（/api/admin/detect-new-pages） ----

type Ctx = Parameters<typeof detectApi>[0];
const call = (env: Record<string, unknown>, init: RequestInit = {}) =>
  detectApi({ request: new Request(`${ORIGIN}/api/admin/detect-new-pages`, init), env } as unknown as Ctx);
const assetsFor = (site: FakeSite) => ({ fetch: (url: URL | string) => site.fetchAsset(new URL(String(url)).pathname) });

await test("12. 秘密キーが無い・違う・未設定の場合は実行できず、GETは受け付けない", async () => {
  const site = new FakeSite(EXISTING);
  const db = new FakeD1();
  const env = { STAFF_DB: db, ASSETS: assetsFor(site), NEWS_DETECT_SECRET: SECRET };
  assert.equal((await call(env, { method: "POST" })).status, 401);
  assert.equal((await call(env, { method: "POST", headers: { Authorization: "Bearer wrong" } })).status, 401);
  assert.equal((await call({ ...env, NEWS_DETECT_SECRET: undefined }, { method: "POST", headers: { Authorization: "Bearer " } })).status, 401, "未設定なら誰も実行できない");
  assert.equal((await call(env, { method: "GET", headers: { Authorization: `Bearer ${SECRET}` } })).status, 405);
  assert.equal(db.queries, 0);
});

await test("12b. 本番以外のアドレス（プレビュー環境・ローカル）から呼んでも、サイトマップの本番URLを正しく読める", async () => {
  const site = new FakeSite(EXISTING);
  const db = new FakeD1();
  const env = { STAFF_DB: db, ASSETS: assetsFor(site), NEWS_DETECT_SECRET: SECRET };
  const res = await detectApi({
    request: new Request("https://preview-abc.nobeoka-ugokasu.pages.dev/api/admin/detect-new-pages", { method: "POST", headers: { Authorization: `Bearer ${SECRET}` } }),
    env,
  } as unknown as Ctx);
  assert.equal(res.status, 200);
  const body = (await res.json()) as { status: string; pageCount: number };
  assert.equal(body.status, "baseline");
  assert.equal(body.pageCount, 4);
});

await test("13. 正しい秘密キーで実行でき、デプロイ未完了なら409。応答・ログに秘密キーは出ない", async () => {
  const site = new FakeSite(EXISTING);
  const db = new FakeD1();
  const env = { STAFF_DB: db, ASSETS: assetsFor(site), NEWS_DETECT_SECRET: SECRET };
  const auth = { Authorization: `Bearer ${SECRET}`, "Content-Type": "application/json" };
  const notLive = await call(env, { method: "POST", headers: auth, body: JSON.stringify({ expectedCommit: "abcdef1" }) });
  assert.equal(notLive.status, 409);
  const ok = await call(env, { method: "POST", headers: auth, body: JSON.stringify({ expectedCommit: COMMIT }) });
  assert.equal(ok.status, 200);
  const body = await ok.json() as { status: string; liveCommit: string };
  assert.equal(body.status, "baseline");
  assert.equal(body.liveCommit, COMMIT);
  site.failing.add("/sitemap-0.xml");
  const failed = await call(env, { method: "POST", headers: auth, body: "{}" });
  assert.equal(failed.status, 500);
  assert.deepEqual(await failed.json(), { ok: false, error: "detect_failed" }, "内部の詳細は返さない");
  const all = logLines.join("\n");
  assert.ok(!all.includes(SECRET), "ログに秘密キーが出ない");
});

await test("14. migrations/0008 はテーブル定義と一致し、何度実行しても既存データを壊さない", async () => {
  const text = readFileSync("migrations/0008_public_pages.sql", "utf8");
  const statements = text
    .split("\n")
    .filter((line) => !line.startsWith("--"))
    .join("\n")
    .split(/;\n/)
    .map((s) => s.trim().replace(/;$/, ""))
    .filter(Boolean);
  assert.deepEqual(statements, PUBLIC_PAGES_SCHEMA_SQL.map((s) => s.trim()));
  const { db } = await baselined();
  for (let i = 0; i < 2; i++) db.sqlite.exec(text);
  assert.equal((await recorded(db)).length, 4);
});

console.log = realLog;
console.error = realError;
console.log(`\n${passed}件のテストに合格しました。`);
