// 後援会執行部ポータル（/staff/）のGoogleログイン・セッション・CSRF・ログイン試行制限のテストです。
// D1はNode標準のSQLite（node:sqlite）で再現し、Googleのトークンエンドポイント・Discovery Document・公開鍵（JWKS）は偽物（モック）に置き換えます。
// 実際のGoogle・Cloudflareへは一切アクセスしません。
//
// 実行: npm run test:staff-auth

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { FakeD1 } from "./helpers/fakeD1";
import { exportJWK, generateKeyPair, SignJWT } from "jose";
import type { StaffAuthEnv } from "../../server/env";
import { parseAllowlist, resetSchemaCache, SESSION_TTL_SECONDS } from "../../server/staffAuth";
import { onRequest as staffMiddleware } from "../../functions/staff/_middleware";
import { onRequestGet as googleStart } from "../../functions/staff/auth/google";
import { onRequestGet as googleCallback } from "../../functions/staff/auth/callback";
import { onRequestPost as logoutPost } from "../../functions/staff/logout";
import { resetGoogleJwksCache } from "../../server/googleOAuth";

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

// ---- Googleのトークンエンドポイント・Discovery Document・公開鍵（JWKS）のモック ----
// テスト用のRSA鍵でIDトークンに署名し、公開鍵をJWKSとして配る（本物のGoogleと同じ検証経路を通す）
interface GoogleBehavior {
  email?: string;
  emailVerified?: boolean | string;
  aud?: string;
  iss?: string;
  expOffset?: number;
  iatOffset?: number;
  nonceOverride?: string;
  status?: number;
  errorBody?: Record<string, string>;
  signWith?: "other_key" | "hs256" | "none";
}
let google: GoogleBehavior = {};
let lastTokenRequest: URLSearchParams | null = null;
let pendingAuth: { nonce: string; challenge: string } | null = null;
let jwksFetches = 0;

const DISCOVERY = "https://accounts.google.com/.well-known/openid-configuration";
const JWKS_URL = "https://www.googleapis.com/oauth2/v3/certs";
const KID = "test-key-1";
const signingKey = await generateKeyPair("RS256", { extractable: true });
const otherKey = await generateKeyPair("RS256", { extractable: true });
const publicJwk = { ...(await exportJWK(signingKey.publicKey)), kid: KID, alg: "RS256", use: "sig" };

const b64url = (v: string) => Buffer.from(v).toString("base64url");
async function signIdToken(claims: Record<string, unknown>): Promise<string> {
  if (google.signWith === "none") return `${b64url(JSON.stringify({ alg: "none" }))}.${b64url(JSON.stringify(claims))}.`;
  if (google.signWith === "hs256") {
    return new SignJWT(claims).setProtectedHeader({ alg: "HS256", kid: KID }).sign(new TextEncoder().encode("x".repeat(32)));
  }
  const key = google.signWith === "other_key" ? otherKey.privateKey : signingKey.privateKey;
  return new SignJWT(claims).setProtectedHeader({ alg: "RS256", kid: KID }).sign(key);
}

globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = String(input);
  if (url === DISCOVERY) return Response.json({ issuer: "https://accounts.google.com", jwks_uri: JWKS_URL });
  if (url === JWKS_URL) {
    jwksFetches++;
    return Response.json({ keys: [publicJwk] });
  }
  if (url !== "https://oauth2.googleapis.com/token") throw new Error(`unexpected fetch: ${url}`);
  const body = new URLSearchParams(String(init?.body));
  lastTokenRequest = body;
  // PKCE：code_verifier のS256がログイン開始時のcode_challengeと一致しなければ拒否（Googleと同じ動作）
  const challenge = createHash("sha256").update(body.get("code_verifier") ?? "").digest("base64url");
  if (!pendingAuth || challenge !== pendingAuth.challenge || body.get("code") !== "valid-code") {
    return Response.json({ error: "invalid_grant", error_description: "Bad Request" }, { status: 400 });
  }
  if (google.status) return Response.json(google.errorBody ?? {}, { status: google.status });
  const now = Math.floor(Date.now() / 1000);
  const claims = {
    iss: google.iss ?? "https://accounts.google.com",
    aud: google.aud ?? CLIENT_ID,
    sub: "1234567890",
    email: google.email ?? ALLOWED,
    email_verified: google.emailVerified ?? true,
    nonce: google.nonceOverride ?? pendingAuth.nonce,
    iat: now + (google.iatOffset ?? 0),
    exp: now + (google.expOffset ?? 3600),
  };
  return Response.json({ id_token: await signIdToken(claims), access_token: "test-access-token" });
}) as typeof fetch;

// ---- サーバーログの記録（秘密情報が含まれないことを確認する） ----
const logLines: string[] = [];
const realWarn = console.warn;
const realLog = console.log;
console.warn = (...args: unknown[]) => void logLines.push(args.map(String).join(" "));
const captureLog = (...args: unknown[]) => {
  const line = args.map(String).join(" ");
  if (line.startsWith("{")) logLines.push(line);
  else realLog(...args);
};
console.log = captureLog;
const loginLogs = () => logLines.filter((l) => l.includes('"event":"staff-login')).map((l) => JSON.parse(l) as Record<string, unknown>);
const lastLoginLog = () => loginLogs().at(-1) ?? {};

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
  assert.equal(callback?.headers.get("Location"), "/staff/login/?error=email_not_allowed");
  assert.equal(cookieValue(setCookies(callback!), "staff_session"), "");
  assert.deepEqual(lastLoginLog(), { event: "staff-login-failed", reason: "email_not_allowed", allowlistCount: 2, allowlistMatch: false });
});

await test("2b. email_verified が true でなければログインできない", async () => {
  for (const emailVerified of [false, "false", ""]) {
    google = { emailVerified };
    const { callback } = await login(makeEnv());
    assert.equal(callback?.headers.get("Location"), "/staff/login/?error=email_not_verified", String(emailVerified));
  }
});

await test("2c. IDトークンの aud・iss・exp・iat・nonce が不正なら拒否し、失敗した項目をログに残す", async () => {
  const cases: [GoogleBehavior, string][] = [
    [{ aud: "other-client" }, "aud"],
    [{ iss: "https://evil.example.com" }, "iss"],
    [{ expOffset: -120 }, "exp"],
    [{ iatOffset: -3600 }, "iat"],
    [{ iatOffset: 3600 }, "iat"],
    [{ nonceOverride: "replayed-nonce" }, "nonce"],
  ];
  for (const [behavior, check] of cases) {
    google = behavior;
    const { callback } = await login(makeEnv());
    assert.equal(callback?.headers.get("Location"), "/staff/login/?error=id_token_invalid", JSON.stringify(behavior));
    assert.equal(lastLoginLog().check, check, JSON.stringify(behavior));
  }
});

await test("2c-2. IDトークンの署名をGoogleの公開鍵（jwks_uri）で検証する：別の鍵・HS256・alg=none は拒否", async () => {
  const cases: [GoogleBehavior["signWith"], string][] = [
    ["other_key", "signature"],
    ["hs256", "alg"],
    ["none", "alg"],
  ];
  for (const [signWith, check] of cases) {
    google = { signWith };
    const { callback } = await login(makeEnv());
    assert.equal(callback?.headers.get("Location"), "/staff/login/?error=id_token_invalid", String(signWith));
    assert.equal(lastLoginLog().check, check, String(signWith));
  }
});

await test("2c-3. 公開鍵は取得後キャッシュし、ログインのたびに取得し直さない", async () => {
  resetGoogleJwksCache();
  jwksFetches = 0;
  const env = makeEnv();
  for (let i = 0; i < 3; i++) assert.equal((await login(env, { ip: `198.51.100.${40 + i}` })).callback?.status, 200);
  assert.equal(jwksFetches, 1);
});

await test("2d. state不一致・stateCookie無し・不正な認可コード（PKCE不一致）では拒否する", async () => {
  const cases: [Parameters<typeof login>[1], string, Record<string, unknown>][] = [
    [{ tamperState: true }, "state_invalid", { check: "state_mismatch" }],
    [{ dropCookie: true }, "state_invalid", { check: "missing_cookie" }],
    [{ code: "stolen-code" }, "oauth_token_exchange", { googleStatus: 400, googleError: "invalid_grant" }],
  ];
  for (const [options, reason, fields] of cases) {
    const { callback } = await login(makeEnv(), options);
    assert.equal(callback?.headers.get("Location"), `/staff/login/?error=${reason}`, JSON.stringify(options));
    assert.deepEqual(lastLoginLog(), { event: "staff-login-failed", reason, allowlistCount: 2, ...fields });
  }
});

await test("2e. トークン交換の失敗はHTTPステータスと既知のエラー種別だけを記録する（Client Secret誤りなど）", async () => {
  google = { status: 401, errorBody: { error: "invalid_client", error_description: "The OAuth client was not found." } };
  const { callback } = await login(makeEnv());
  assert.equal(callback?.headers.get("Location"), "/staff/login/?error=oauth_token_exchange");
  assert.deepEqual(lastLoginLog(), {
    event: "staff-login-failed",
    reason: "oauth_token_exchange",
    allowlistCount: 2,
    googleStatus: 401,
    googleError: "invalid_client",
  });
  google = { status: 400, errorBody: { error: "something-unexpected <script>" } };
  await login(makeEnv());
  assert.equal(lastLoginLog().googleError, "other", "未知のエラー文字列はそのまま記録しない");
});

await test("2f. D1の障害・セッション作成の失敗は d1_error・session_error に分ける", async () => {
  const brokenDb = new FakeD1();
  brokenDb.prepare = () => {
    throw new Error("D1_ERROR: no such table");
  };
  const start = await googleStart(context(makeEnv(brokenDb), req("/staff/auth/google")).ctx);
  assert.equal(start.headers.get("Location"), "/staff/login/?error=d1_error");

  const db = new FakeD1();
  const env = makeEnv(db);
  const originalBatch = db.batch.bind(db);
  db.batch = async (statements) => {
    if (statements.some((s) => s.sql.includes("INSERT INTO staff_sessions"))) throw new Error("D1_ERROR");
    return originalBatch(statements);
  };
  const { callback } = await login(env);
  assert.equal(callback?.headers.get("Location"), "/staff/login/?error=session_error");
  assert.equal(lastLoginLog().reason, "session_error");
  assert.equal(lastLoginLog().allowlistMatch, true);
});

await test("2g. ログには Client Secret・認可コード・トークン・Cookie・メールアドレスを一切含めない", async () => {
  logLines.length = 0;
  const env = makeEnv();
  await login(env);
  google = { email: "stranger@gmail.com" };
  await login(env);
  google = { status: 401, errorBody: { error: "invalid_client" } };
  await login(env);
  google = { signWith: "other_key" };
  await login(env);
  const logs = logLines.join("\n");
  assert.ok(loginLogs().length >= 4, "ログイン結果は毎回記録する");
  for (const secret of ["test-client-secret", "valid-code", "test-access-token", "eyJ", "staff_oauth", "staff_session", "example.com", "gmail.com"]) {
    assert.ok(!logs.includes(secret), `ログに含めない: ${secret}`);
  }
});

await test("2h. STAFF_ALLOWED_EMAILS：空白除去・小文字化・カンマ区切り、全角カンマ・引用符などの誤入力を検知する", async () => {
  assert.deepEqual(parseAllowlist(" A@Example.com , b@example.com\nc@example.com;d@example.com "), {
    emails: ["a@example.com", "b@example.com", "c@example.com", "d@example.com"],
    warnings: [],
  });
  assert.deepEqual(parseAllowlist("a@example.com，b@example.com、c@example.com"), {
    emails: ["a@example.com", "b@example.com", "c@example.com"],
    warnings: ["fullwidth_separator"],
  });
  assert.deepEqual(parseAllowlist(`"a@example.com", 'b@example.com' “c@example.com”`), {
    emails: ["a@example.com", "b@example.com", "c@example.com"],
    warnings: ["quotes"],
  });
  assert.deepEqual(parseAllowlist("ａ@example.com, not-an-email, b@example.com"), { emails: ["b@example.com"], warnings: ["invalid_entry"] });
  assert.deepEqual(parseAllowlist(undefined), { emails: [], warnings: [] });

  // 誤入力があっても正しく読めた分ではログインでき、警告の種類だけがログに残る
  const env = { ...makeEnv(), STAFF_ALLOWED_EMAILS: `"${ALLOWED}"，other@example.com` };
  const { callback } = await login(env);
  assert.equal(callback?.status, 200);
  assert.deepEqual(lastLoginLog(), {
    event: "staff-login-succeeded",
    allowlistMatch: true,
    allowlistCount: 2,
    allowlistWarnings: ["fullwidth_separator", "quotes"],
  });
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
    assert.equal(res.headers.get("Cache-Control"), "private, no-store, no-transform", "管理画面は計測タグの自動挿入対象外");
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
    assert.equal(start.headers.get("Location"), "/staff/login/?error=config_error", missing);
    const callback = await googleCallback(context(broken, req("/staff/auth/callback?code=valid-code&state=x")).ctx);
    assert.equal(callback.headers.get("Location"), "/staff/login/?error=config_error", missing);
    assert.equal((lastLoginLog().configured as Record<string, boolean>)[missing], false, missing);
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
console.warn = realWarn;
console.log = realLog;
console.log(`\n${passed}件のテストに合格しました。`);
