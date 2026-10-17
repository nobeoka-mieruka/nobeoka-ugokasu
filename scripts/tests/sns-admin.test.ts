// SNS管理（/staff/sns/・/staff/api/sns/status・/staff/api/sns/sync）のテストです。
// KVは Map、Meta・Threads の API は偽物（モック）に置き換えます。実際のSNS・Cloudflareへは一切アクセスしません。
//
// 実行: npm run test:sns-admin

import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { captureLogs, controllableClock, createCaller, fakeDb, loginAs, makeEnv, testRunner, type Auth, type Router } from "./helpers/staffHarness";
import { resetSchemaCache } from "../../server/staffAuth";
import { configuredPlatforms, resetSnsAdminSchemaCache, SNS_ADMIN_SCHEMA_SQL } from "../../server/snsAdmin";
import { runSocialSync } from "../../server/socialSync";
import * as statusApi from "../../functions/staff/api/sns/status";
import * as syncApi from "../../functions/staff/api/sns/sync";
import { onRequestPost as legacySyncApi } from "../../functions/api/admin/sync-social-posts";

// ---- KV（Map） ----
class MemoryKV {
  store = new Map<string, string>();
  async get(key: string, type?: string) {
    const value = this.store.get(key);
    if (value === undefined) return null;
    return type === "json" ? JSON.parse(value) : value;
  }
  async put(key: string, value: string) {
    this.store.set(key, typeof value === "string" ? value : String(value));
  }
  async getWithMetadata() {
    return { value: null, metadata: null };
  }
  async delete(key: string) {
    this.store.delete(key);
  }
}

// ---- 偽のSNS API ----
const META_TOKEN = "EAAG-meta-access-token-SECRET-123";
const THREADS_TOKEN = "THQ-threads-token-SECRET-456";
const SYNC_SECRET = "sync-secret-SECRET-789";
const CRON_SECRET = "cron-secret-SECRET-000";
let metaMode: "ok" | "error" = "ok";
let snsCalls = 0;
globalThis.fetch = (async (input: RequestInfo | URL) => {
  const url = new URL(String(input));
  if (url.hostname === "graph.facebook.com" || url.hostname === "graph.threads.net") {
    snsCalls++;
    if (metaMode === "error") {
      // 実際のAPIのエラー応答にトークンが含まれていても、画面・応答には出さないことを確認する
      return new Response(JSON.stringify({ error: { message: `Invalid OAuth access token: ${META_TOKEN}`, code: 190 } }), { status: 400 });
    }
    if (url.pathname.endsWith("/published_posts")) {
      return Response.json({
        data: [
          { id: "page_1", message: "駅前で街頭活動をしました", created_time: "2026-10-15T10:00:00+0000", permalink_url: "https://www.facebook.com/p/1" },
          { id: "page_2", message: "<script>alert(1)</script>看板を設置しました", created_time: "2026-10-10T10:00:00+0000", permalink_url: "https://www.facebook.com/p/2" },
        ],
      });
    }
    return Response.json({ data: [] });
  }
  throw new Error(`unexpected fetch: ${url.href}`);
}) as typeof fetch;

const router: Router = (method, pathname) => {
  if (pathname === "/staff/api/sns/status" && method === "GET") return { handler: statusApi.onRequestGet as never, params: {} };
  if (pathname === "/staff/api/sns/sync" && method === "POST") return { handler: syncApi.onRequestPost as never, params: {} };
  return { handler: null, params: {} };
};
const { call } = createCaller(router);
const clock = controllableClock();
const logs = captureLogs();

const configuredEnv = () =>
  makeEnv({
    SOCIAL_POSTS_KV: new MemoryKV() as unknown as KVNamespace,
    FACEBOOK_PAGE_ID: "1234567890",
    META_ACCESS_TOKEN: META_TOKEN,
    SOCIAL_SYNC_SECRET: SYNC_SECRET,
    SOCIAL_CRON_SECRET: CRON_SECRET,
  });
type Env = ReturnType<typeof configuredEnv>;
const SECRETS = [META_TOKEN, THREADS_TOKEN, SYNC_SECRET, CRON_SECRET, "1234567890"];
const assertNoSecrets = (text: string, label: string) => {
  for (const secret of SECRETS) assert.ok(!text.includes(secret), `${label} に秘密情報を含めない: ${secret.slice(0, 6)}…`);
};
const status = async (env: Env, auth: Auth) => {
  const r = await call(env, "/staff/api/sns/status", auth);
  assert.equal(r.res.status, 200, r.text);
  assertNoSecrets(r.text, "状態API");
  return (r.json as { status: { platforms: { platform: string; state: string; postCount: number }[]; lastCheckedAt: string | null; recentPosts: { title: string }[]; manualSyncAvailableAt: number | null } }).status;
};
const sync = (env: Env, auth: Auth, extra: Record<string, unknown> = {}) => call(env, "/staff/api/sns/sync", { method: "POST", body: {}, ...auth, ...extra });
const auditRows = async (env: Env) => {
  // 一度も実行されていない（拒否された）場合はテーブル自体がまだ無い
  if (!(await fakeDb(env).prepare("SELECT name FROM sqlite_master WHERE name = 'staff_audit_log'").first())) return [];
  return (await fakeDb(env).prepare("SELECT action, target_type, detail FROM staff_audit_log WHERE target_type = 'sns'").all<{ action: string; detail: string }>()).results;
};

const { test, done } = testRunner(() => {
  clock.reset();
  metaMode = "ok";
  snsCalls = 0;
  logs.lines.length = 0;
  resetSchemaCache();
  resetSnsAdminSchemaCache();
});

// =========================================================
await test("1. 未ログインでは /staff/sns/ に入れず、状態も同期も実行できない", async () => {
  const env = configuredEnv();
  const page = await call(env, "/staff/sns/");
  assert.equal(page.res.status, 302);
  assert.equal(page.res.headers.get("Location"), "/staff/login/");
  assert.equal((await call(env, "/staff/api/sns/status")).res.status, 401);
  assert.equal((await call(env, "/staff/api/sns/sync", { method: "POST", body: {} })).res.status, 401);
  assert.equal(snsCalls, 0, "SNSのAPIを呼ばない");
});

await test("2. 状態表示：未設定のSNSは「未設定」、設定済みで記録が無ければ「未同期」（連携中と誤表示しない）", async () => {
  const env = configuredEnv();
  const auth = await loginAs(env);
  const s = await status(env, auth);
  assert.deepEqual(s.platforms.map((p) => [p.platform, p.state]), [["facebook", "not_synced"], ["instagram", "not_configured"], ["threads", "not_configured"]]);
  assert.equal(s.lastCheckedAt, null);
  assert.equal(snsCalls, 0, "状態表示ではSNSのAPIを呼ばない");
  const none = makeEnv({ SOCIAL_POSTS_KV: new MemoryKV() as unknown as KVNamespace });
  const noneAuth = await loginAs(none);
  const r = await call(none, "/staff/api/sns/status", noneAuth);
  assert.ok((r.json as { status: { platforms: { state: string }[] } }).status.platforms.every((p) => p.state === "not_configured"));
});

await test("3. 「設定済み」の判定は、既存の同期処理が取得を試みる条件と同じ", async () => {
  for (const extra of [
    { FACEBOOK_PAGE_ID: "1", META_ACCESS_TOKEN: META_TOKEN },
    { INSTAGRAM_USER_ID: "2", META_ACCESS_TOKEN: META_TOKEN },
    { THREADS_USER_ID: "3", THREADS_ACCESS_TOKEN: THREADS_TOKEN },
    { FACEBOOK_PAGE_ID: "1" },
    { THREADS_USER_ID: "3", META_ACCESS_TOKEN: META_TOKEN },
  ]) {
    const env = { SOCIAL_POSTS_KV: new MemoryKV() as unknown as KVNamespace, ...extra };
    const result = await runSocialSync(env as never);
    const configured = configuredPlatforms(env);
    for (const platform of ["facebook", "instagram", "threads"] as const) {
      assert.equal(configured[platform], result.status[platform] !== "not_configured", `${JSON.stringify(Object.keys(extra))} ${platform}`);
    }
  }
});

await test("4. 「今すぐ同期」：既存の同期処理をサーバー側で実行し、成功／件数／日時だけを返す。最終同期日時・投稿が更新される", async () => {
  const env = configuredEnv();
  const auth = await loginAs(env);
  const r = await sync(env, auth);
  assert.equal(r.res.status, 200, r.text);
  assertNoSecrets(r.text, "同期API");
  const body = r.json as { ok: boolean; synced: boolean; checkedAt: string; counts: Record<string, number> };
  assert.deepEqual(Object.keys(body).sort(), ["checkedAt", "counts", "ok", "states", "synced"]);
  assert.equal(body.synced, true);
  assert.deepEqual(body.counts, { facebook: 2, instagram: 0, threads: 0 });
  const s = await status(env, auth);
  assert.equal(s.platforms[0].state, "ok");
  assert.equal(s.platforms[0].postCount, 2);
  assert.equal(s.lastCheckedAt, body.checkedAt);
  assert.equal(s.recentPosts[0].title.includes("駅前で街頭活動"), true);
  const audit = await auditRows(env);
  assert.equal(audit.length, 1);
  assert.equal(audit[0].action, "sns.sync");
  assert.deepEqual(JSON.parse(audit[0].detail), { ok: true, facebook: 2, instagram: 0, threads: 0 });
  assert.ok(logs.lines.some((l) => l.includes('"trigger":"staff-manual"')), "サーバーログに手動同期の記録");
});

await test("5. 連打防止：60秒以内の2回目は実行せず429。60秒後は実行できる（SNSのAPI呼び出しは2回だけ）", async () => {
  const env = configuredEnv();
  const auth = await loginAs(env);
  assert.equal((await sync(env, auth)).res.status, 200);
  const callsAfterFirst = snsCalls;
  for (let i = 0; i < 5; i++) {
    const r = await sync(env, auth);
    assert.equal(r.res.status, 429);
    assert.ok((r.json as { retryAt: number }).retryAt > Date.now() / 1000);
  }
  assert.equal(snsCalls, callsAfterFirst, "連打してもSNSのAPIを呼ばない");
  assert.ok((await status(env, auth)).manualSyncAvailableAt! > Date.now() / 1000, "画面に次に実行できる日時を返す");
  clock.advance(61_000);
  assert.equal((await sync(env, auth)).res.status, 200);
  assert.equal(snsCalls, callsAfterFirst * 2);
  assert.equal((await auditRows(env)).length, 2, "実行されたものだけを記録");
});

await test("6. 同期に失敗した場合は「失敗」だけを返し、APIのエラー内容・トークンは画面・応答・操作ログに出さない", async () => {
  const env = configuredEnv();
  const auth = await loginAs(env);
  metaMode = "error";
  const r = await sync(env, auth);
  assert.equal(r.res.status, 200);
  assertNoSecrets(r.text, "同期API（失敗時）");
  assert.ok(!r.text.includes("Invalid OAuth"), "SNS側のエラー文を返さない");
  assert.equal((r.json as { synced: boolean }).synced, false);
  assert.equal((await status(env, auth)).platforms[0].state, "error");
  const audit = await auditRows(env);
  assert.deepEqual(JSON.parse(audit[0].detail), { ok: false, facebook: 0, instagram: 0, threads: 0 });
  assertNoSecrets(JSON.stringify(audit), "操作ログ");
  // 既存の同期処理の要約ログ（social-sync）も含め、サーバーログ全体に秘密情報が出ていない（エラー文のトークンは伏せ字）
  assert.ok(logs.lines.some((l) => l.includes('"event":"social-sync"') && l.includes("[REDACTED]")), "失敗時のエラー文はトークンを伏せ字にして記録");
  assertNoSecrets(logs.lines.join("\n"), "サーバーログ");
});

await test("7. CSRFトークン無し・不一致・別サイトからの同期要求は403（SNSのAPIを呼ばない）", async () => {
  const env = configuredEnv();
  const auth = await loginAs(env);
  for (const extra of [{ csrf: null }, { csrf: "wrong" }, { origin: "https://evil.example.com" }, { origin: null }]) {
    const r = await sync(env, auth, extra);
    assert.equal(r.res.status, 403, JSON.stringify(extra));
    assert.equal(r.reachedHandler, false);
  }
  assert.equal(snsCalls, 0);
  assert.equal((await auditRows(env)).length, 0);
});

await test("8. 既存の秘密キー付き同期API（Cron・管理者用）はそのまま：秘密キー無しでは401", async () => {
  const env = configuredEnv();
  const request = new Request("https://nobeoka-ugokasu.pages.dev/api/admin/sync-social-posts", { method: "POST" });
  const res = await legacySyncApi({ request, env } as never);
  assert.equal(res.status, 401);
  assert.equal(snsCalls, 0);
  const ok = await legacySyncApi({ request: new Request(request, { headers: { Authorization: `Bearer ${CRON_SECRET}` } }), env } as never);
  assert.equal(ok.status, 200, "Cron用の秘密キーでは従来どおり実行できる");
});

await test("9. SNS管理の画面・スクリプトに秘密キーを含めない（ビルド済みファイルを検査）", () => {
  const html = new URL("../../dist/staff/sns/index.html", import.meta.url);
  assert.ok(existsSync(html), "npm run build の後に実行");
  const page = readFileSync(html, "utf8");
  for (const name of ["SOCIAL_SYNC_SECRET", "SOCIAL_CRON_SECRET", "META_ACCESS_TOKEN", "THREADS_ACCESS_TOKEN", "/api/admin/sync-social-posts", "Bearer"]) {
    assert.ok(!page.includes(name), `画面に ${name} を含めない`);
  }
  const astroDir = new URL("../../dist/_astro/", import.meta.url);
  for (const file of readdirSync(astroDir).filter((f) => f.endsWith(".js"))) {
    const js = readFileSync(new URL(file, astroDir), "utf8");
    if (!js.includes("/staff/api/sns")) continue;
    for (const name of ["SOCIAL_SYNC_SECRET", "SOCIAL_CRON_SECRET", "META_ACCESS_TOKEN", "/api/admin/sync-social-posts", "Bearer"]) {
      assert.ok(!js.includes(name), `${file} に ${name} を含めない`);
    }
  }
  assert.ok(page.includes('target="_blank" rel="noopener noreferrer"'), "公式アカウントは新しいタブで開く");
});

await test("migration：ファイルの定義が実行時の定義と一致し、CREATE … IF NOT EXISTS だけを含む", () => {
  const text = readFileSync(new URL("../../migrations/0006_staff_rate_limits.sql", import.meta.url), "utf8");
  const statements = text
    .split("\n")
    .filter((line) => !line.startsWith("--"))
    .join("\n")
    .split(/;\n/)
    .map((s) => s.trim().replace(/;$/, ""))
    .filter(Boolean);
  assert.deepEqual(statements, SNS_ADMIN_SCHEMA_SQL.map((s) => s.trim()));
  for (const s of statements) assert.match(s, /^CREATE (TABLE|INDEX) IF NOT EXISTS /);
});

logs.restore();
clock.restore();
done();
