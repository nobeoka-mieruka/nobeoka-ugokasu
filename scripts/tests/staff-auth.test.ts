// 後援会執行部ポータル（/staff/）のGoogleログイン・セッション・CSRF・ログイン試行制限のテストです。
// D1はNode標準のSQLite（node:sqlite）で再現し、Googleのトークンエンドポイントは偽物（モック）に置き換えます。
// 実際のGoogle・Cloudflareへは一切アクセスしません。
//
// 実行: npm run test:staff-auth

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import type { StaffAuthEnv } from "../../server/env";
import { resetSchemaCache, SESSION_TTL_SECONDS } from "../../server/staffAuth";
import { onRequest as staffMiddleware } from "../../functions/staff/_middleware";
import { onRequestGet as googleStart } from "../../functions/staff/auth/google";
import { onRequestGet as googleCallback } from "../../functions/staff/auth/callback";
import { onRequestPost as logoutPost } from "../../functions/staff/logout";

// ---- D1互換のラッパー（node:sqlite） ----
class FakeStatement {
  constructor(
    private db: DatabaseSync,
    private sql: string,
    private params: unknown[] = [],
  ) {}
  bind(...params: unknown[]) {
    return new FakeStatement(this.db, this.sql, params);
  }
  async first<T>() {
    return (this.db.prepare(this.sql).get(...(this.params as never[])) ?? null) as T | null;
  }
  async run() {
    this.db.prepare(this.sql).run(...(this.params as never[]));
    return { success: true };
  }
}
class FakeD1 {
  queries = 0;
  constructor(public sqlite = new DatabaseSync(":memory:")) {}
  prepare(sql: string) {
    this.queries++;
    return new FakeStatement(this.sqlite, sql);
  }
  async batch(statements: FakeStatement[]) {
    this.sqlite.exec("BEGIN");
    try {
      for (const s of statements) await s.run();
      this.sqlite.exec("COMMIT");
    } catch (err) {
      this.sqlite.exec("ROLLBACK");
      throw err;
    }
    return [];
  }
}

// HTMLRewriterはWorkers専用のため、単体テストでは素通しにする（差し込みはwrangler上の結合テストで確認）
(globalThis as Record<string, unknown>).HTMLRewriter = class {
  on() {
    return this;
  }
  transform(res: Response) {
    return res;
  }
};

// ---- テスト用の設定値（すべて架空の値） ----
const ORIGIN = "https://nobeoka-ugokasu.pages.dev";
const CLIENT_ID = "test-client-id.apps.googleusercontent.com";
const ALLOWED = "staff@example.com";
const makeEnv = (db: FakeD1 = new FakeD1()): StaffAuthEnv & { STAFF_DB: D1Database } => ({
  STAFF_DB: db as unknown as D1Database,
  GOOGLE_CLIENT_ID: CLIENT_ID,
  GOOGLE_CLIENT_SECRET: "test-client-secret",
  STAFF_ALLOWED_EMAILS: ` ${ALLOWED.toUpperCase()},\nsecond@example.com `,
});

// ---- 時刻の差し替え ----
const realNow = Date.now;
let timeOffsetMs = 0;
Date.now = () => realNow() + timeOffsetMs;

// ---- Googleのトークンエンドポイントのモック ----
interface GoogleBehavior {
  email?: string;
  emailVerified?: boolean | string;
  aud?: string;
  iss?: string;
  expOffset?: number;
  nonceOverride?: string;
  status?: number;
}
let google: GoogleBehavior = {};
let lastTokenRequest: URLSearchParams | null = null;
let pendingAuth: { nonce: string; challenge: string } | null = null;

const b64url = (v: string) => Buffer.from(v).toString("base64url");
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = String(input);
  if (url !== "https://oauth2.googleapis.com/token") throw new Error(`unexpected fetch: ${url}`);
  const body = new URLSearchParams(String(init?.body));
  lastTokenRequest = body;
  // PKCE：code_verifier のS256がログイン開始時のcode_challengeと一致しなければ拒否（Googleと同じ動作）
  const challenge = createHash("sha256").update(body.get("code_verifier") ?? "").digest("base64url");
  if (!pendingAuth || challenge !== pendingAuth.challenge || body.get("code") !== "valid-code") {
    return new Response(JSON.stringify({ error: "invalid_grant" }), { status: 400 });
  }
  if (google.status) return new Response("{}", { status: google.status });
  const claims = {
    iss: google.iss ?? "https://accounts.google.com",
    aud: google.aud ?? CLIENT_ID,
    sub: "1234567890",
    email: google.email ?? ALLOWED,
    email_verified: google.emailVerified ?? true,
    nonce: google.nonceOverride ?? pendingAuth.nonce,
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + (google.expOffset ?? 3600),
  };
  const idToken = `${b64url(JSON.stringify({ alg: "RS256" }))}.${b64url(JSON.stringify(claims))}.signature`;
  return new Response(JSON.stringify({ id_token: idToken, access_token: "x" }), { headers: { "Content-Type": "application/json" } });
}) as typeof fetch;

// ---- Pages Functionsのコンテキスト ----
const PORTAL_HTML = '<html><body><h1>執行部ポータル</h1><span data-staff-email></span></body></html>';
function context(env: StaffAuthEnv, request: Request) {
  let reachedOrigin = false;
  const ctx = {
    request,
    env,
    data: {} as Record<string, unknown>,
    next: async () => {
      reachedOrigin = true;
      return new Response(PORTAL_HTML, { headers: { "Content-Type": "text/html; charset=utf-8" } });
    },
  };
  return { ctx: ctx as unknown as EventContext<StaffAuthEnv, string, Record<string, unknown>>, reached: () => reachedOrigin };
}

function req(path: string, init: RequestInit & { cookie?: string; ip?: string } = {}) {
  const headers = new Headers(init.headers);
  if (init.cookie) headers.set("Cookie", init.cookie);
  headers.set("CF-Connecting-IP", init.ip ?? "203.0.113.10");
  return new Request(`${ORIGIN}${path}`, { ...init, headers });
}

async function visit(env: StaffAuthEnv, path: string, init: Parameters<typeof req>[1] = {}) {
  const { ctx, reached } = context(env, req(path, init));
  const res = await staffMiddleware(ctx);
  return { res, body: await res.text(), reachedOrigin: reached() };
}

const setCookies = (res: Response) => res.headers.getSetCookie();
const cookieValue = (cookies: string[], name: string) =>
  cookies.find((c) => c.startsWith(`${name}=`))?.split(";")[0].slice(name.length + 1) ?? "";

/** Googleログインを最初から最後まで行い、コールバックの応答を返す */
async function login(env: StaffAuthEnv, options: { ip?: string; tamperState?: boolean; dropCookie?: boolean; code?: string } = {}) {
  const start = await googleStart(context(env, req("/staff/auth/google", { ip: options.ip })).ctx);
  const location = start.headers.get("Location") ?? "";
  if (!location.startsWith("https://accounts.google.com/")) return { start, callback: null as Response | null };
  const authUrl = new URL(location);
  pendingAuth = { nonce: authUrl.searchParams.get("nonce") ?? "", challenge: authUrl.searchParams.get("code_challenge") ?? "" };
  const oauthCookie = `staff_oauth=${cookieValue(setCookies(start), "staff_oauth")}`;
  const state = options.tamperState ? "attacker-state" : authUrl.searchParams.get("state");
  const callback = await googleCallback(
    context(
      env,
      req(`/staff/auth/callback?code=${options.code ?? "valid-code"}&state=${state}`, {
        ip: options.ip,
        cookie: options.dropCookie ? undefined : oauthCookie,
      }),
    ).ctx,
  );
  return { start, callback, authUrl };
}

let passed = 0;
async function test(name: string, fn: () => Promise<void> | void) {
  google = {};
  timeOffsetMs = 0;
  pendingAuth = null;
  resetSchemaCache();
  try {
    await fn();
    passed++;
    console.log(`✓ ${name}`);
  } catch (err) {
    console.error(`✗ ${name}`);
    throw err;
  }
}

// =========================================================
await test("1. 許可されたGoogleアカウントでログインでき、/staff/ を表示できる", async () => {
  const env = makeEnv();
  const { callback, authUrl } = await login(env);
  assert.equal(callback?.status, 200);
  assert.equal(authUrl?.searchParams.get("redirect_uri"), `${ORIGIN}/staff/auth/callback`);
  assert.equal(authUrl?.searchParams.get("scope"), "openid email");
  assert.equal(authUrl?.searchParams.get("code_challenge_method"), "S256");
  assert.equal(lastTokenRequest?.get("client_secret"), "test-client-secret", "Client Secretはサーバー間通信でのみ送る");
  assert.ok(!authUrl?.toString().includes("test-client-secret"), "Client SecretをブラウザへのURLに含めない");
  const session = cookieValue(setCookies(callback!), "staff_session");
  assert.match(session, /^[A-Za-z0-9_-]{43}$/, "256bitのセッションID");
  const portal = await visit(env, "/staff/", { cookie: `staff_session=${session}` });
  assert.equal(portal.res.status, 200);
  assert.ok(portal.reachedOrigin);
});

await test("2. 許可されていないGoogleアカウントではログインできない（OAuthに成功しても入れない）", async () => {
  google = { email: "stranger@gmail.com" };
  const { callback } = await login(makeEnv());
  assert.equal(callback?.status, 302);
  assert.equal(callback?.headers.get("Location"), "/staff/login/?error=failed");
  assert.equal(cookieValue(setCookies(callback!), "staff_session"), "");
});

await test("2b. email_verified が true でなければログインできない", async () => {
  for (const emailVerified of [false, "false", undefined as unknown as boolean]) {
    google = { emailVerified };
    if (emailVerified === undefined) google = { emailVerified: "" };
    const { callback } = await login(makeEnv());
    assert.equal(callback?.headers.get("Location"), "/staff/login/?error=failed", String(emailVerified));
  }
});

await test("2c. IDトークンの aud・iss・期限・nonce が不正なら拒否する", async () => {
  for (const behavior of [{ aud: "other-client" }, { iss: "https://evil.example.com" }, { expOffset: -60 }, { nonceOverride: "replayed-nonce" }] as GoogleBehavior[]) {
    google = behavior;
    const { callback } = await login(makeEnv());
    assert.equal(callback?.headers.get("Location"), "/staff/login/?error=failed", JSON.stringify(behavior));
  }
});

await test("2d. state不一致・stateCookie無し・不正な認可コード（PKCE不一致）では拒否する", async () => {
  for (const options of [{ tamperState: true }, { dropCookie: true }, { code: "stolen-code" }]) {
    const { callback } = await login(makeEnv(), options);
    assert.equal(callback?.headers.get("Location"), "/staff/login/?error=failed", JSON.stringify(options));
  }
});

await test("3・4. 未ログインでは /staff/ 以下へ入れず、HTMLも返さない", async () => {
  const env = makeEnv();
  for (const path of ["/staff/", "/staff", "/staff/index.html", "/staff/anything/", "/staff/api/secret"]) {
    const { res, body, reachedOrigin } = await visit(env, path);
    assert.equal(reachedOrigin, false, path);
    assert.ok(!body.includes("執行部ポータル"), path);
    if (path.startsWith("/staff/api/")) assert.equal(res.status, 401, path);
    else {
      assert.equal(res.status, 302, path);
      assert.equal(res.headers.get("Location"), "/staff/login/", path);
    }
    assert.equal(res.headers.get("Cache-Control"), "private, no-store");
    assert.equal(res.headers.get("X-Robots-Tag"), "noindex, nofollow");
  }
  for (const cookie of ["staff_session=forged", `staff_session=${"A".repeat(43)}`]) {
    const { res, reachedOrigin } = await visit(env, "/staff/", { cookie });
    assert.equal(res.status, 302);
    assert.equal(reachedOrigin, false);
  }
});

await test("3b. 設定漏れ（D1・Client ID等が無い）では誰もログインできない", async () => {
  const env = makeEnv();
  for (const missing of ["STAFF_DB", "GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "STAFF_ALLOWED_EMAILS"] as const) {
    const broken = { ...env, [missing]: undefined };
    const start = await googleStart(context(broken, req("/staff/auth/google")).ctx);
    assert.equal(start.headers.get("Location"), "/staff/login/?error=unavailable", missing);
  }
  const { res, reachedOrigin } = await visit({}, "/staff/", { cookie: `staff_session=${"A".repeat(43)}` });
  assert.equal(res.status, 302);
  assert.equal(reachedOrigin, false);
});

await test("ログイン画面とGoogleログインの入口は未ログインでも表示できる", async () => {
  const env = makeEnv();
  for (const path of ["/staff/login/", "/staff/login", "/staff/auth/google", "/staff/auth/callback"]) {
    const { reachedOrigin, res } = await visit(env, path);
    assert.ok(reachedOrigin, path);
    assert.equal(res.headers.get("X-Robots-Tag"), "noindex, nofollow", path);
  }
});

await test("5・6・7. セッションCookieは HttpOnly・Secure・SameSite=Strict・Path=/staff・12時間", async () => {
  const { callback } = await login(makeEnv());
  const cookie = setCookies(callback!).find((c) => c.startsWith("staff_session="))!;
  assert.match(cookie, /; HttpOnly/);
  assert.match(cookie, /; Secure/);
  assert.match(cookie, /; SameSite=Strict/);
  assert.match(cookie, /; Path=\/staff;/);
  assert.match(cookie, new RegExp(`; Max-Age=${SESSION_TTL_SECONDS};`));
  assert.equal(SESSION_TTL_SECONDS, 43200);
  const oauth = setCookies(callback!).find((c) => c.startsWith("staff_oauth="))!;
  assert.match(oauth, /Max-Age=0/, "ログイン後はstate等のCookieを消す");
});

await test("D1には生のセッションIDではなくSHA-256ハッシュだけを保存する", async () => {
  const db = new FakeD1();
  const { callback } = await login(makeEnv(db));
  const session = cookieValue(setCookies(callback!), "staff_session");
  const rows = db.sqlite.prepare("SELECT * FROM staff_sessions").all() as Record<string, unknown>[];
  assert.equal(rows.length, 1);
  assert.ok(!JSON.stringify(rows).includes(session));
  assert.equal(rows[0].id_hash, createHash("sha256").update(session).digest("base64url"));
  assert.equal(Number(rows[0].expires_at) - Number(rows[0].created_at), 43200);
});

await test("8. ログアウトするとD1のセッションが即時削除され、同じCookieは使えない", async () => {
  const db = new FakeD1();
  const env = makeEnv(db);
  const { callback } = await login(env);
  const cookie = `staff_session=${cookieValue(setCookies(callback!), "staff_session")}`;
  const csrf = (db.sqlite.prepare("SELECT csrf_token FROM staff_sessions").get() as { csrf_token: string }).csrf_token;

  const form = new URLSearchParams({ csrf_token: csrf });
  const init = { method: "POST", cookie, body: form, headers: { Origin: ORIGIN, "Content-Type": "application/x-www-form-urlencoded" } };
  const { ctx } = context(env, req("/staff/logout", init));
  ctx.next = async () => logoutPost(context(env, req("/staff/logout", init)).ctx);
  const res = await staffMiddleware(ctx);
  assert.equal(res.status, 303);
  assert.equal(res.headers.get("Location"), "/staff/login/?logged_out=1");
  assert.match(setCookies(res).join(), /staff_session=; Path=\/staff; Max-Age=0/);
  assert.equal((db.sqlite.prepare("SELECT COUNT(*) AS n FROM staff_sessions").get() as { n: number }).n, 0);

  const reuse = await visit(env, "/staff/", { cookie });
  assert.equal(reuse.res.status, 302);
  assert.equal(reuse.reachedOrigin, false);
});

await test("9. 12時間を過ぎたセッションは使えず、再ログインが必要", async () => {
  const env = makeEnv();
  const { callback } = await login(env);
  const cookie = `staff_session=${cookieValue(setCookies(callback!), "staff_session")}`;
  timeOffsetMs = (SESSION_TTL_SECONDS - 60) * 1000;
  assert.equal((await visit(env, "/staff/", { cookie })).res.status, 200, "期限直前は有効");
  timeOffsetMs = (SESSION_TTL_SECONDS + 1) * 1000;
  const expired = await visit(env, "/staff/", { cookie });
  assert.equal(expired.res.status, 302);
  assert.equal(expired.reachedOrigin, false);
  assert.match(setCookies(expired.res).join(), /staff_session=; /, "期限切れのCookieは消す");
});

await test("10. 同じIPから5回失敗すると15分間ログインを受け付けない", async () => {
  const env = makeEnv();
  google = { email: "stranger@gmail.com" };
  for (let i = 0; i < 5; i++) await login(env, { ip: "198.51.100.7" });
  google = {};
  const blocked = await login(env, { ip: "198.51.100.7" });
  assert.equal(blocked.start.headers.get("Location"), "/staff/login/?error=locked", "正しいアカウントでも制限中は不可");
  const otherIp = await login(env, { ip: "198.51.100.8" });
  assert.equal(otherIp.callback?.status, 200, "別のIPには影響しない");
  timeOffsetMs = 16 * 60 * 1000;
  const later = await login(env, { ip: "198.51.100.7" });
  assert.equal(later.callback?.status, 200, "15分経過後は解除");
});

await test("10b. 同じアカウントへの失敗はIPを変えても数え、5回でそのアカウントを制限する", async () => {
  const env = makeEnv();
  google = { email: "stranger@gmail.com" };
  for (let i = 0; i < 5; i++) await login(env, { ip: `192.0.2.${i}` });
  const blocked = await login(env, { ip: "192.0.2.99" });
  assert.equal(blocked.callback?.headers.get("Location"), "/staff/login/?error=locked");
});

await test("10c. state改ざん等の不正なコールバックも失敗として数える", async () => {
  const env = makeEnv();
  for (let i = 0; i < 5; i++) await login(env, { ip: "198.51.100.20", tamperState: true });
  const blocked = await login(env, { ip: "198.51.100.20" });
  assert.equal(blocked.start.headers.get("Location"), "/staff/login/?error=locked");
});

await test("CSRF：トークン無し・不一致・別サイトからの更新リクエストは拒否する", async () => {
  const db = new FakeD1();
  const env = makeEnv(db);
  const { callback } = await login(env);
  const cookie = `staff_session=${cookieValue(setCookies(callback!), "staff_session")}`;
  const csrf = (db.sqlite.prepare("SELECT csrf_token FROM staff_sessions").get() as { csrf_token: string }).csrf_token;
  const form = (token?: string) => (token ? new URLSearchParams({ csrf_token: token }) : new URLSearchParams());
  const cases: [string, RequestInit][] = [
    ["トークン無し", { method: "POST", body: form(), headers: { Origin: ORIGIN, "Content-Type": "application/x-www-form-urlencoded" } }],
    ["トークン不一致", { method: "POST", body: form("wrong"), headers: { Origin: ORIGIN, "Content-Type": "application/x-www-form-urlencoded" } }],
    ["別サイトから", { method: "POST", body: form(csrf), headers: { Origin: "https://evil.example", "Content-Type": "application/x-www-form-urlencoded" } }],
    ["Origin・Sec-Fetch-Site無し", { method: "POST", body: form(csrf), headers: { "Content-Type": "application/x-www-form-urlencoded" } }],
    ["DELETE（ヘッダーのトークン不一致）", { method: "DELETE", headers: { Origin: ORIGIN, "X-CSRF-Token": "wrong" } }],
  ];
  for (const [label, init] of cases) {
    const { res, reachedOrigin } = await visit(env, "/staff/api/example", { ...init, cookie });
    assert.equal(res.status, 403, label);
    assert.equal(reachedOrigin, false, label);
  }
  for (const method of ["POST", "PUT", "PATCH", "DELETE"]) {
    const ok = await visit(env, "/staff/api/example", { method, cookie, headers: { Origin: ORIGIN, "X-CSRF-Token": csrf } });
    assert.ok(ok.reachedOrigin, `${method}：正しいトークンなら通す`);
  }
});

await test("許可リストから外されたメンバーは、ログイン中のセッションも使えなくなる", async () => {
  const env = makeEnv();
  const { callback } = await login(env);
  const cookie = `staff_session=${cookieValue(setCookies(callback!), "staff_session")}`;
  assert.equal((await visit(env, "/staff/", { cookie })).res.status, 200);
  const removed = { ...env, STAFF_ALLOWED_EMAILS: "second@example.com" };
  const after = await visit(removed, "/staff/", { cookie });
  assert.equal(after.res.status, 302);
  assert.equal(after.reachedOrigin, false);
});

await test("ログイン済みでログイン画面を開くとポータルへ移動する", async () => {
  const env = makeEnv();
  const { callback } = await login(env);
  const cookie = `staff_session=${cookieValue(setCookies(callback!), "staff_session")}`;
  const { res } = await visit(env, "/staff/login/", { cookie });
  assert.equal(res.headers.get("Location"), "/staff/");
});

Date.now = realNow;
console.log(`\n${passed}件のテストに合格しました。`);
