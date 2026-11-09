// サイトの状態（監視）のテストです。
//   server/siteHealth.ts・/api/admin/site-health・/staff/api/site-status・scripts/monitor/site-check.mjs
// D1はNode標準のSQLite（node:sqlite）、KV・静的ファイルはメモリ上の偽物です。実際のCloudflare・GitHubへは一切アクセスしません。
//
// 実行: npm run test:site-health

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { captureLogs, createCaller, loginAs, makeEnv, testRunner, type Router } from "./helpers/staffHarness";
import { FakeD1 } from "./helpers/fakeD1";
import { resetSchemaCache } from "../../server/staffAuth";
import { createNewsItem, resetNewsSchemaCache } from "../../server/newsItems";
import { resetSnsAdminSchemaCache } from "../../server/snsAdmin";
import {
  MONITOR_ACTOR,
  MONITOR_STALE_SECONDS,
  SITE_HEALTH_SCHEMA_SQL,
  parseMonitorChecks,
  readSiteStatus,
  recordMonitorChecks,
  resetSiteHealthSchemaCache,
} from "../../server/siteHealth";
import { onRequest as siteHealthApi } from "../../functions/api/admin/site-health";
import * as siteStatusApi from "../../functions/staff/api/site-status";
import {
  cardTitles,
  dialoguePageAccepting,
  evaluateDeploy,
  evaluateDialogueForm,
  evaluateRss,
  evaluateSnsBuild,
  evaluateWorkflows,
  googleFormAccepting,
  rssTitles,
} from "../monitor/site-check.mjs";
import { decideSocialRebuild } from "../social-rebuild.mjs";
import { postsSignature } from "../social-signature.mjs";
import { renderNewsRss } from "../../server/newsRss";
import { renderHomeNews, renderNewsList } from "../../src/utils/newsCards";
import type { NewsDisplayItem } from "../../src/types/news";

const logs = captureLogs();
const { test, done } = testRunner(() => {
  resetSchemaCache();
  resetNewsSchemaCache();
  resetSnsAdminSchemaCache();
  resetSiteHealthSchemaCache();
  logs.lines.length = 0;
});

const ORIGIN = "https://nobeoka-ugokasu.pages.dev";
const SECRET = "test-monitor-secret-value";
const META_TOKEN = "META_TOKEN_SHOULD_NEVER_APPEAR_1234567890";
const NOW = 1_800_000_000;

class MemoryKV {
  store = new Map<string, string>();
  async get(key: string, type?: string) {
    const value = this.store.get(key);
    if (value === undefined) return null;
    return type === "json" ? JSON.parse(value) : value;
  }
  async put(key: string, value: string) {
    this.store.set(key, value);
  }
}

const auditRows = (db: D1Database) =>
  (db as unknown as FakeD1).prepare("SELECT action, target_id, actor_email, detail FROM staff_audit_log ORDER BY id").all<{ action: string; target_id: string; actor_email: string; detail: string }>().then((r) => r.results ?? []);
const checkRows = (db: D1Database) =>
  (db as unknown as FakeD1).prepare("SELECT check_key, status, since, checked_at FROM site_health_checks ORDER BY check_key").all<{ check_key: string; status: string; since: number; checked_at: number }>().then((r) => r.results ?? []);

const ok = (key: "deploy" | "site_update" | "rss") => ({ key, status: "ok" as const, summary: `${key}は正常` });

// ---- 定期チェックの結果の保存 ----

await test("1. 受け付けるのは決まった種類・状態だけ（不正な内容は400）。説明文は短くし制御文字を除く", () => {
  assert.equal(parseMonitorChecks(null), null);
  assert.equal(parseMonitorChecks({ checks: [] }), null);
  assert.equal(parseMonitorChecks({ checks: [{ key: "drop_table", status: "ok", summary: "" }] }), null);
  assert.equal(parseMonitorChecks({ checks: [{ key: "deploy", status: "broken", summary: "" }] }), null);
  assert.equal(parseMonitorChecks({ checks: [ok("deploy"), ok("deploy")] }), null, "同じ種類の重複");
  const parsed = parseMonitorChecks({ checks: [{ key: "rss", status: "warning", summary: `a\u0000b\n${"x".repeat(500)}` }] })!;
  assert.equal(parsed[0].summary.length, 300);
  assert.ok(!/[\u0000-\u001F]/.test(parsed[0].summary));
});

await test("2. 正常のまま変わらない項目は書き込まない。異常になったときだけ確認待ちとして操作ログに記録する", async () => {
  const db = new FakeD1() as unknown as D1Database;
  const first = await recordMonitorChecks(db, [ok("deploy"), ok("site_update"), ok("rss")], NOW);
  assert.deepEqual(first, { written: ["deploy", "site_update", "rss"], alerted: [] });

  const second = await recordMonitorChecks(db, [ok("deploy"), ok("site_update"), ok("rss")], NOW + 3600);
  assert.deepEqual(second, { written: [], alerted: [] }, "正常のままなら書き込まない");
  assert.equal((await checkRows(db)).find((r) => r.check_key === "monitor")!.checked_at, NOW + 3600, "定期チェックの実行日時だけ更新");

  const failing = { key: "deploy" as const, status: "error" as const, summary: "反映されていません" };
  const third = await recordMonitorChecks(db, [failing, ok("site_update"), ok("rss")], NOW + 7200);
  assert.deepEqual(third, { written: ["deploy"], alerted: ["deploy"] });
  const fourth = await recordMonitorChecks(db, [failing, ok("site_update"), ok("rss")], NOW + 10800);
  assert.deepEqual(fourth, { written: ["deploy"], alerted: [] }, "異常が続いても記録は最初の1回だけ");
  const deploy = (await checkRows(db)).find((r) => r.check_key === "deploy")!;
  assert.deepEqual([deploy.status, deploy.since, deploy.checked_at], ["error", NOW + 7200, NOW + 10800], "異常の開始日時は最初のまま");

  const fifth = await recordMonitorChecks(db, [ok("deploy"), ok("site_update"), ok("rss")], NOW + 14400);
  assert.deepEqual(fifth, { written: ["deploy"], alerted: [] }, "回復も記録する（操作ログには残さない）");
  const audit = await auditRows(db);
  assert.equal(audit.length, 1);
  assert.deepEqual([audit[0].action, audit[0].target_id, audit[0].actor_email], ["site.health", "deploy", MONITOR_ACTOR]);
});

// ---- POST /api/admin/site-health ----

const callHealth = (init: RequestInit, env: Record<string, unknown>) =>
  siteHealthApi({ request: new Request(`${ORIGIN}/api/admin/site-health`, init), env } as never);

await test("3. /api/admin/site-health：POST以外は405、秘密キーが無い・違う・未設定は401（記録しない）", async () => {
  const db = new FakeD1() as unknown as D1Database;
  const body = JSON.stringify({ checks: [ok("deploy")] });
  assert.equal((await callHealth({ method: "GET" }, { STAFF_DB: db, NEWS_DETECT_SECRET: SECRET })).status, 405);
  assert.equal((await callHealth({ method: "POST", body }, { STAFF_DB: db, NEWS_DETECT_SECRET: SECRET })).status, 401);
  assert.equal((await callHealth({ method: "POST", body, headers: { Authorization: "Bearer wrong" } }, { STAFF_DB: db, NEWS_DETECT_SECRET: SECRET })).status, 401);
  assert.equal((await callHealth({ method: "POST", body, headers: { Authorization: "Bearer " } }, { STAFF_DB: db })).status, 401, "秘密キーが未設定なら誰も実行できない");
  const tables = await (db as unknown as FakeD1).prepare("SELECT name FROM sqlite_master WHERE name = 'site_health_checks'").all();
  assert.equal(tables.results?.length ?? 0, 0, "認証前にD1へ触れない");
});

await test("4. /api/admin/site-health：正しい秘密キーなら記録する。不正な本文は400。ログに秘密キーを出さない", async () => {
  const db = new FakeD1() as unknown as D1Database;
  const env = { STAFF_DB: db, NEWS_DETECT_SECRET: SECRET };
  const auth = { Authorization: `Bearer ${SECRET}` };
  assert.equal((await callHealth({ method: "POST", headers: auth, body: "not json" }, env)).status, 400);
  assert.equal((await callHealth({ method: "POST", headers: auth, body: JSON.stringify({ checks: [{ key: "x" }] }) }, env)).status, 400);
  const res = await callHealth({ method: "POST", headers: auth, body: JSON.stringify({ checks: [{ key: "rss", status: "warning", summary: "一致しません" }] }) }, env);
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { ok: true, written: ["rss"], alerted: ["rss"] });
  assert.equal((await callHealth({ method: "POST", headers: auth, body: JSON.stringify({ checks: [ok("rss")] }) }, { NEWS_DETECT_SECRET: SECRET })).status, 503);
  assert.ok(!logs.lines.join("\n").includes(SECRET));
});

// ---- ポータルの表示 ----

function assetsWith(files: Record<string, unknown>) {
  return {
    fetch: async (input: RequestInfo | URL) => {
      const path = new URL(String(input instanceof Request ? input.url : input)).pathname;
      return path in files ? new Response(JSON.stringify(files[path]), { status: 200 }) : new Response("not found", { status: 404 });
    },
  } as unknown as Fetcher;
}

async function statusEnv() {
  const db = new FakeD1() as unknown as D1Database;
  const kv = new MemoryKV();
  await kv.put(
    "social-posts:heartbeat:v1",
    JSON.stringify({
      checkedAt: "2026-11-08T13:54:41.000Z",
      lastSuccessAt: "2026-10-19T04:57:00.000Z",
      status: { facebook: "error", instagram: "not_configured", threads: "not_configured" },
      platforms: { facebook: { lastSuccessAt: "2026-10-19T04:57:00.000Z", lastFailureAt: "2026-11-08T13:54:41.000Z", errorKind: "token_expired", failingSince: "2026-10-19T05:00:00.000Z" } },
    }),
  );
  await kv.put(
    "social-posts:cache:v1",
    JSON.stringify({
      posts: [
        { platform: "facebook", id: "1", title: "看板", publishedAt: "2026-10-15T01:00:00.000Z", permalink: "https://www.facebook.com/p/1" },
        { platform: "facebook", id: "2", title: "集会", publishedAt: "2026-10-18T01:00:00.000Z", permalink: "https://www.facebook.com/p/2" },
      ],
      updatedAt: "2026-10-19T04:57:00.000Z",
      status: { facebook: "ok", instagram: "not_configured", threads: "not_configured" },
    }),
  );
  const env = {
    STAFF_DB: db,
    SOCIAL_POSTS_KV: kv as unknown as KVNamespace,
    FACEBOOK_PAGE_ID: "1234567890",
    META_ACCESS_TOKEN: META_TOKEN,
    ASSETS: assetsWith({
      "/build-version.json": { commitSha: "438cc0e0000000000000000000000000000000aa", builtAt: "2026-11-08T08:00:00.000Z" },
      "/news/file-items.json": { items: [{ key: "article:a", date: "2026-11-08" }, { key: "social:1", date: "2026-11-09" }] },
    }),
  };
  return env;
}
const byKey = (status: Awaited<ReturnType<typeof readSiteStatus>>, key: string) => status.items.find((i) => i.key === key)!;

await test("5. 表示：Facebookのトークン期限切れは「失敗」で「トークンの更新が必要」と表示し、最終取得成功・最新投稿の日時を出す", async () => {
  const env = await statusEnv();
  const status = await readSiteStatus(env, ORIGIN, NOW);
  assert.equal(byKey(status, "sns_errors").state, "error");
  assert.match(byKey(status, "sns_errors").summary, /Facebook：トークンの更新が必要/);
  assert.equal(byKey(status, "facebook_success").state, "error");
  assert.equal(byKey(status, "facebook_success").at, "2026-10-19T04:57:00.000Z");
  assert.equal(byKey(status, "facebook_latest_post").at, "2026-10-18T01:00:00.000Z");
  assert.equal(byKey(status, "live_build").at, "2026-11-08T08:00:00.000Z");
  assert.match(byKey(status, "live_build").summary, /438cc0e/);
  assert.match(byKey(status, "news_updated").summary, /2026-11-08/, "記事ファイルの最新掲載日（SNS投稿は除く）");
  const text = JSON.stringify(status);
  assert.ok(!text.includes(META_TOKEN) && !text.includes("1234567890"), "秘密情報・ページIDを表示しない");
});

await test("6. 表示：確認待ちのお知らせ（自動作成の下書き）の件数。定期チェックの記録が無い・古い場合は「要確認」", async () => {
  const env = await statusEnv();
  const input = { publishedOn: "2026-11-08", category: "notice" as const, title: "下書き", summary: "", linkUrl: "/x/", isPublished: false, displayOrder: 0 };
  await createNewsItem(env.STAFF_DB, input, "system:page-detect", "page:/x/");
  await createNewsItem(env.STAFF_DB, { ...input, linkUrl: "/y/" }, "system:page-detect", "page:/y/");
  await createNewsItem(env.STAFF_DB, { ...input, title: "手作業の下書き" }, "staff@example.com");
  let status = await readSiteStatus(env, ORIGIN, NOW);
  assert.equal(byKey(status, "pending_news").state, "warning");
  assert.match(byKey(status, "pending_news").summary, /^2件/);
  for (const key of ["deploy", "site_update", "rss", "monitor"]) assert.equal(byKey(status, key).state, "warning", key);

  await recordMonitorChecks(env.STAFF_DB, [ok("deploy"), ok("site_update"), ok("rss")], NOW);
  status = await readSiteStatus(env, ORIGIN, NOW + 60);
  for (const key of ["deploy", "site_update", "rss", "monitor"]) assert.equal(byKey(status, key).state, "ok", key);
  status = await readSiteStatus(env, ORIGIN, NOW + MONITOR_STALE_SECONDS + 60);
  assert.equal(byKey(status, "monitor").state, "warning", "定期チェックが止まっている");
  assert.equal(status.counts.ok + status.counts.warning + status.counts.error, status.items.length);
});

await test("7. 表示：公開中のビルド情報やSNSの記録を読めなくても、画面は表示できる（要確認になる）", async () => {
  const env = { STAFF_DB: new FakeD1() as unknown as D1Database, ASSETS: assetsWith({}) };
  const status = await readSiteStatus(env, ORIGIN, NOW);
  assert.equal(byKey(status, "live_build").state, "warning");
  assert.equal(byKey(status, "sns_errors").state, "warning");
});

const router: Router = (method, pathname) =>
  pathname === "/staff/api/site-status" && method === "GET" ? { handler: siteStatusApi.onRequestGet as never, params: {} } : { handler: null, params: {} };
const { call } = createCaller(router);

await test("8. /staff/api/site-status：ログインしていなければ中身を返さない。ログイン中は状態を返す", async () => {
  const env = makeEnv();
  const anonymous = await call(env, "/staff/api/site-status");
  assert.notEqual(anonymous.res.status, 200);
  assert.equal(anonymous.reachedHandler, false);
  const auth = await loginAs(env);
  const res = await call(env, "/staff/api/site-status", auth);
  assert.equal(res.res.status, 200, res.text);
  assert.ok(Array.isArray((res.json as { status: { items: unknown[] } }).status.items));
});

// ---- 定期チェックの判定（scripts/monitor/site-check.mjs） ----

await test("9. デプロイの判定：一致は正常、反映待ち（30分以内）は正常、30分を過ぎても違えば失敗、読めなければ要確認", () => {
  const now = Date.parse("2026-11-08T10:00:00Z");
  assert.equal(evaluateDeploy({ liveSha: "abc1234", headSha: "abc1234", headCommittedAt: "2026-11-08T09:00:00Z", now }).status, "ok");
  assert.equal(evaluateDeploy({ liveSha: "old0000", headSha: "abc1234", headCommittedAt: "2026-11-08T09:45:00Z", now }).status, "ok");
  const failed = evaluateDeploy({ liveSha: "old0000", headSha: "abc1234", headCommittedAt: "2026-11-08T09:00:00Z", now });
  assert.equal(failed.status, "error");
  assert.match(failed.summary, /abc1234.*old0000/);
  assert.equal(evaluateDeploy({ liveSha: null, headSha: "abc1234", headCommittedAt: null, now }).status, "warning");
});

await test("10. 自動処理の判定：最新の実行が失敗していれば失敗。成功・スキップ・取り消しは正常", () => {
  assert.equal(evaluateWorkflows([]).status, "ok");
  assert.equal(evaluateWorkflows([{ label: "A", conclusion: "success" }, { label: "B", conclusion: "cancelled" }]).status, "ok");
  const failed = evaluateWorkflows([{ label: "A", conclusion: "success" }, { label: "B", conclusion: "failure" }]);
  assert.equal(failed.status, "error");
  assert.match(failed.summary, /^Bの/);
});

await test("11. RSSの一致の判定：実際の描画（RSS・お知らせ一覧・トップページ）から読み取ったタイトルで比較する", () => {
  const items: NewsDisplayItem[] = [
    { key: "d1:1", date: "2026-11-08", title: "記号 <&> \"引用\" 'です'", summary: "", category: "お知らせ", href: "", displayOrder: 0 },
    { key: "article:a", date: "2026-11-07", title: "記事A", summary: "", category: "お知らせ", href: "/news/a/", displayOrder: 0 },
    { key: "article:b", date: "2026-11-06", title: "記事B", summary: "", category: "お知らせ", href: "/news/b/", displayOrder: 0 },
    { key: "article:c", date: "2026-11-05", title: "記事C", summary: "", category: "お知らせ", href: "/news/c/", displayOrder: 0 },
  ];
  const rss = rssTitles(renderNewsRss(items, ORIGIN));
  const list = cardTitles(`<div data-news-list>${renderNewsList(items)}</div>`, "data-news-list");
  const home = cardTitles(`<div data-news-home>${renderHomeNews(items)}</div>`, "data-news-home");
  assert.deepEqual(rss, items.map((i) => i.title));
  assert.deepEqual(list, rss);
  assert.deepEqual(home, rss.slice(0, 3));
  assert.equal(evaluateRss({ rss, list, home }).status, "ok");
  assert.equal(evaluateRss({ rss, list: list!.slice(1), home }).status, "warning");
  assert.equal(evaluateRss({ rss, list: [...list!].reverse(), home }).status, "warning", "順番の違い");
  assert.equal(evaluateRss({ rss: null, list, home }).status, "warning");
  assert.equal(cardTitles("<html></html>", "data-news-list"), null);
});

await test("12. migration 0009：ファイルの定義が実行時の定義と一致し、CREATE … IF NOT EXISTS だけを含む（既存データを変えない）", () => {
  // Windowsで取り出すと改行が CRLF になるため、改行をそろえてから比べる
  const sql = readFileSync("migrations/0009_site_health_checks.sql", "utf8").replace(/\r\n/g, "\n");
  const statements = sql.replace(/--.*$/gm, "").split(";").map((s) => s.trim()).filter(Boolean);
  const norm = (s: string) => s.replace(/\s+/g, " ").trim();
  assert.deepEqual(statements.map(norm), [norm(SITE_HEALTH_SCHEMA_SQL[0])]);
  assert.ok(statements.every((s) => /^CREATE TABLE IF NOT EXISTS /.test(s)));
  assert.ok(!/\b(DROP|DELETE|ALTER|UPDATE|INSERT)\b/i.test(sql.replace(/--.*$/gm, "")));
});

// ---- SNSの公開中HTML・意見交換会の申込フォーム（第2次改善） ----

const feedOf = (ids: string[]) => ({
  posts: ids.map((id) => ({ platform: "facebook", id, publishedAt: "2026-11-04T07:36:22+0000", title: `投稿${id}`, description: "", permalink: `https://www.facebook.com/p/${id}`, localImage: null, mediaCount: 1 })),
});
const NOW_MS = Date.parse("2026-11-09T03:00:00Z");
const minutesAgo = (m: number) => new Date(NOW_MS - m * 60000).toISOString();

await test("13. 再ビルドの判定：同じ計算の署名で比べ、一致なら何もしない。不一致でも直前のビルドから20分以内は再ビルドしない", () => {
  const feed = feedOf(["1", "2"]);
  const latest = postsSignature(feed.posts);
  const match = decideSocialRebuild({ feed, manifest: { generatedAt: minutesAgo(90), signature: "x", feedSignature: latest }, now: NOW_MS });
  assert.deepEqual([match.rebuild, match.state], [false, "match"]);
  const stale = { generatedAt: minutesAgo(90), signature: "x", feedSignature: "old" };
  assert.equal(decideSocialRebuild({ feed, manifest: stale, now: NOW_MS }).rebuild, true);
  const fresh = { ...stale, generatedAt: minutesAgo(5) };
  const waiting = decideSocialRebuild({ feed, manifest: fresh, now: NOW_MS });
  assert.deepEqual([waiting.rebuild, waiting.state], [false, "waiting"], "ビルド直後は再ビルドを重ねない（無限ループ・重複ビルドの防止）");
  assert.equal(decideSocialRebuild({ feed, manifest: fresh, now: NOW_MS, force: true }).rebuild, true, "手動の強制再ビルドは可能");
  assert.equal(decideSocialRebuild({ feed: null, manifest: stale, now: NOW_MS }).rebuild, false, "本番APIを読めないときは再ビルドしない");
  // 以前のビルド（feedSignature が無い）は signature で比べる
  assert.equal(decideSocialRebuild({ feed, manifest: { generatedAt: minutesAgo(90), signature: latest }, now: NOW_MS }).state, "match");
  assert.equal(decideSocialRebuild({ feed, manifest: null, now: NOW_MS }).rebuild, true, "公開中のビルドの記録が無ければ作り直す");
});

await test("14. SNSの公開中HTML：定期取得が最新なのにHTMLだけ60分以上古いときだけ「要確認」。反映待ちは正常", () => {
  const feed = feedOf(["1", "2"]);
  const latest = postsSignature(feed.posts);
  assert.equal(evaluateSnsBuild({ feed, manifest: { generatedAt: minutesAgo(300), feedSignature: latest }, now: NOW_MS }).status, "ok");
  assert.equal(evaluateSnsBuild({ feed, manifest: { generatedAt: minutesAgo(10), feedSignature: "old" }, now: NOW_MS }).status, "ok", "再ビルド待ち");
  const stale = evaluateSnsBuild({ feed, manifest: { generatedAt: minutesAgo(120), feedSignature: "old" }, now: NOW_MS });
  assert.equal(stale.status, "warning");
  assert.match(stale.summary, /公開中のHTML（検索エンジン向け）が60分以上古い/);
  assert.equal(evaluateSnsBuild({ feed: null, manifest: null, now: NOW_MS }).status, "warning");
});

await test("15. 申込フォームの受付状態の読み取り（受付を止めたフォームは /closedform へ転送される）", () => {
  const base = "https://docs.google.com/forms/d/e/abc";
  assert.equal(googleFormAccepting({ finalUrl: `${base}/viewform`, html: "<script>var FB_PUBLIC_LOAD_DATA_ = []</script>" }), true);
  assert.equal(googleFormAccepting({ finalUrl: `${base}/closedform`, html: "<html></html>" }), false);
  assert.equal(googleFormAccepting({ finalUrl: `${base}/viewform`, html: "このフォームは回答を受け付けていません" }), false);
  assert.equal(googleFormAccepting({ finalUrl: "https://accounts.google.com/ServiceLogin", html: "<html></html>" }), null, "判断できないときは推測しない");
  assert.equal(googleFormAccepting({ finalUrl: null, html: null }), null);
  assert.equal(dialoguePageAccepting('<div data-dialogue-form-apply><a data-dialogue-form-open href="x">'), true);
  assert.equal(dialoguePageAccepting("<p data-dialogue-form-closed>"), false);
  assert.equal(dialoguePageAccepting("<html></html>"), null);
});

await test("16. 意見交換会：ページの受付表示とGoogleフォームの受付状態が食い違ったら知らせる", () => {
  assert.equal(evaluateDialogueForm({ pageAccepting: true, formAccepting: true }).status, "ok");
  assert.equal(evaluateDialogueForm({ pageAccepting: false, formAccepting: false }).status, "ok");
  assert.equal(evaluateDialogueForm({ pageAccepting: true, formAccepting: false }).status, "error", "受付中と表示しているのに申し込めない");
  const stillOpen = evaluateDialogueForm({ pageAccepting: false, formAccepting: true });
  assert.equal(stillOpen.status, "warning");
  assert.match(stillOpen.summary, /「回答を受け付ける」をオフ/);
  assert.equal(evaluateDialogueForm({ pageAccepting: true, formAccepting: null }).status, "warning");
});

await test("17. 新しいチェック（sns_build・dialogue_form）を受け付け、ポータルに「最終同期」「最新投稿」「最終ビルド」を別々に表示する", async () => {
  const parsed = parseMonitorChecks({ checks: [{ key: "sns_build", status: "ok", summary: "a" }, { key: "dialogue_form", status: "warning", summary: "b" }] });
  assert.equal(parsed?.length, 2);
  const env = await statusEnv();
  env.ASSETS = assetsWith({
    "/build-version.json": { commitSha: "9a53c22000000000000000000000000000000000", builtAt: "2026-11-08T14:42:31.000Z" },
    "/news/file-items.json": { items: [] },
    "/social-build-manifest.json": { generatedAt: "2026-11-08T15:37:12.000Z", signature: "6-x", feedSignature: "6-x", count: 6 },
  });
  const status = await readSiteStatus(env, ORIGIN, Math.floor(Date.parse("2026-11-08T13:58:00Z") / 1000));
  assert.equal(byKey(status, "sns_last_sync").at, "2026-11-08T13:54:41.000Z");
  assert.equal(byKey(status, "sns_last_sync").state, "ok");
  assert.equal(byKey(status, "facebook_latest_post").at, "2026-10-18T01:00:00.000Z");
  assert.equal(byKey(status, "sns_build_time").at, "2026-11-08T15:37:12.000Z");
  assert.match(byKey(status, "sns_build_time").summary, /6件/);
  assert.equal(byKey(status, "sns_build").state, "warning", "定期チェックの記録がまだ無い");
  assert.equal(byKey(status, "dialogue_form").state, "warning");
  const later = await readSiteStatus(env, ORIGIN, Math.floor(Date.parse("2026-11-08T14:30:00Z") / 1000));
  assert.equal(byKey(later, "sns_last_sync").state, "warning", "15分以上同期していない");
});

logs.restore();
done();
