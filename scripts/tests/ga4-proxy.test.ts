// GA4 中継（services/ga4-proxy）と、Cloudflare 側の中継方式（server/ga4Proxy.ts・server/ga4Analytics.ts）のテストです。
// Google（メタデータサーバー・GA4 Data API）への通信はすべて偽物の fetch で置き換えます。実際のGoogleへは一切アクセスしません。
// 中継は 127.0.0.1 の空いているポートで実際に起動し、Cloudflare 側からは本物の fetch で呼びます。
// テスト中の数値・シークレットはすべてテスト用の架空の値で、実際のアクセス数・本番の値ではありません。
//
// 実行: npm run test:ga4-proxy

import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { captureLogs, testRunner } from "./helpers/staffHarness";
import {
  DATA_API_BASE,
  GA4_SCOPE,
  GOOGLE_ERROR_MESSAGE_MAX,
  HEALTH_CHECK_PATH,
  MAX_BODY_BYTES,
  googleErrorSummary,
  NonceStore,
  RateLimiter,
  canonicalString,
  createProxy,
  readProxyConfig,
  sha256Hex,
  signCanonical,
  validateReportBody,
} from "../../services/ga4-proxy/src/proxy.mjs";
import { createProxyServer } from "../../services/ga4-proxy/src/server.mjs";
import { proxyErrorInfo, readGa4ProxyConfig, signProxyRequest } from "../../server/ga4Proxy";
import {
  TRACKED_EVENTS,
  buildEventsByPageRequest,
  buildEventsByTypeRequest,
  buildMainBatch,
  getAnalyticsReport,
  parseAnalyticsRange,
  resetGa4Caches,
} from "../../server/ga4Analytics";
import { PORTAL_TRACKED_EVENTS, portalRange, portalRequests } from "../../services/ga4-proxy/scripts/portal-requests.mjs";
import type { AnalyticsApiResponse } from "../../src/types/analytics";
import { readFileSync } from "node:fs";
import { analyticsRelayHosting } from "../../src/config/analyticsRelayConfig";
import { japaneseDate, relayHostingNotice } from "../../src/utils/analyticsRelayNotice";
import { spawn, spawnSync } from "node:child_process";
import { evaluatePolicy, evaluateService } from "../../services/ga4-proxy/scripts/eval-lib.mjs";

const logs = captureLogs();
const { test, done } = testRunner(() => {
  resetGa4Caches();
  logs.lines.length = 0;
});

// ---- テスト用の値（架空） ----

const SECRET = "test-secret-0123456789-abcdefghijklmnop";
const OLD_SECRET = "old-test-secret-9876543210-zyxwvutsrqpon";
const PROPERTY_ID = "123456789";
const ACCESS_TOKEN = "ya29.TEST_PROXY_TOKEN_SHOULD_NEVER_APPEAR";
const GOOGLE_ERROR_BODY = "GOOGLE_ERROR_DETAIL_SHOULD_NEVER_APPEAR";
const METADATA_URL = "http://metadata.test/computeMetadata/v1/instance/service-accounts/default/token";
/** 2026-11-10 00:30（日本時間） */
const NOW = new Date("2026-11-09T15:30:00Z").getTime();
const NOW_S = Math.floor(NOW / 1000);

const baseConfig = (extra: Record<string, unknown> = {}) => {
  const setting = readProxyConfig({ GA4_PROPERTY_ID: PROPERTY_ID, PROXY_HMAC_SECRET: SECRET, PROXY_METADATA_TOKEN_URL: METADATA_URL, ...extra });
  assert.ok(setting.ok);
  return setting.config;
};

const row = (dims: string[], mets: number[]) => ({ dimensionValues: dims.map((value) => ({ value })), metricValues: mets.map((v) => ({ value: String(v) })) });
const FIXTURE_MAIN = {
  reports: [
    { rows: [row(["current"], [1200, 300, 450]), row(["previous"], [1000, 250, 400])] },
    { rows: [row(["20261105"], [200, 50, 60])] },
    { rows: [row(["/"], [400]), row(["/dialogue/"], [200])] },
    { rows: [row(["Organic Search"], [200])] },
    { rows: [row(["mobile"], [300])] },
  ],
};
const FIXTURE_EVENTS = { rows: [row(["welfare_apply_click", "/dialogue/"], [12])] };

interface Call {
  url: string;
  headers: Headers;
  body: string;
}

/** 偽物の Google（メタデータサーバー・GA4 Data API） */
function fakeGoogle(options: { metadataStatus?: number; dataStatus?: number; typeStatus?: number; networkDown?: boolean } = {}) {
  const calls: Call[] = [];
  const fetchFn = async (input: string, init: RequestInit = {}) => {
    const call = { url: String(input), headers: new Headers(init.headers), body: String(init.body ?? "") };
    calls.push(call);
    if (options.networkDown) throw new Error(GOOGLE_ERROR_BODY);
    const fail = (status: number) => new Response(JSON.stringify({ error: { message: GOOGLE_ERROR_BODY } }), { status });
    if (call.url.startsWith(METADATA_URL)) {
      if (options.metadataStatus) return fail(options.metadataStatus);
      return Response.json({ access_token: ACCESS_TOKEN, expires_in: 3599, token_type: "Bearer" });
    }
    if (options.dataStatus) return fail(options.dataStatus);
    if (call.url.endsWith(":batchRunReports")) return Response.json(FIXTURE_MAIN);
    const isType = (JSON.parse(call.body).dimensions ?? []).some((d: { name: string }) => d.name === "customEvent:content_type");
    if (isType && options.typeStatus) return fail(options.typeStatus);
    return Response.json(FIXTURE_EVENTS);
  };
  return { calls, fetchFn, dataCalls: () => calls.filter((c) => c.url.startsWith(DATA_API_BASE)) };
}

/** 中継へ送るリクエストを、Cloudflare 側と同じ署名関数で作る */
async function signed(path: string, body: unknown, options: { secret?: string; nowS?: number; nonce?: string } = {}) {
  const text = typeof body === "string" ? body : JSON.stringify(body);
  const headers = await signProxyRequest(options.secret ?? SECRET, path, text, options.nowS ?? NOW_S, options.nonce);
  const lower = Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]));
  return { method: "POST", path, headers: lower, body: text };
}

const REPORT_BODY = { dateRanges: [{ startDate: "2026-11-02", endDate: "2026-11-08" }], metrics: [{ name: "screenPageViews" }], limit: 100 };

function assertNoSecrets(text: string, label: string) {
  for (const secret of [SECRET, OLD_SECRET, ACCESS_TOKEN, GOOGLE_ERROR_BODY]) {
    assert.ok(!text.includes(secret), `${label} に秘密情報・Googleのエラー内容が含まれない: ${secret.slice(0, 10)}`);
  }
}

// ---- 中継の設定 ----

await test("1. 中継の設定：プロパティIDは数字のみ、シークレットは32文字以上。値そのものは結果に含めない", () => {
  assert.deepEqual(readProxyConfig({}), { ok: false, issue: "property_id" });
  assert.deepEqual(readProxyConfig({ GA4_PROPERTY_ID: "G-GYSZ7DQ1D1", PROXY_HMAC_SECRET: SECRET }), { ok: false, issue: "property_id" });
  assert.deepEqual(readProxyConfig({ GA4_PROPERTY_ID: PROPERTY_ID }), { ok: false, issue: "secret" });
  assert.deepEqual(readProxyConfig({ GA4_PROPERTY_ID: PROPERTY_ID, PROXY_HMAC_SECRET: "short" }), { ok: false, issue: "secret" });
  assert.deepEqual(readProxyConfig({ GA4_PROPERTY_ID: PROPERTY_ID, PROXY_HMAC_SECRET: SECRET, PROXY_HMAC_SECRET_PREVIOUS: "short" }), { ok: false, issue: "secret" });
  const ok = readProxyConfig({ GA4_PROPERTY_ID: PROPERTY_ID, PROXY_HMAC_SECRET: SECRET, PROXY_HMAC_SECRET_PREVIOUS: OLD_SECRET });
  assert.ok(ok.ok);
  assert.deepEqual(ok.config.secrets, [SECRET, OLD_SECRET]);
  assert.equal(ok.config.perMinute, 60);
  assert.equal(ok.config.perDay, 2000);
});

await test("2. Cloudflare側の設定：中継の値が無ければ従来方式、片方だけ・形式違いは未設定（数値を出さない）", () => {
  const env = (extra: Record<string, unknown> = {}) => ({ GA4_PROPERTY_ID: PROPERTY_ID, GA4_PROXY_URL: "https://ga4-proxy-abc.a.run.app/", GA4_PROXY_SECRET: SECRET, ...extra });
  assert.deepEqual(readGa4ProxyConfig({}), { kind: "none" });
  assert.deepEqual(readGa4ProxyConfig({ GA4_PROPERTY_ID: PROPERTY_ID }), { kind: "none" });
  assert.deepEqual(readGa4ProxyConfig(env({ GA4_PROXY_SECRET: "" })), { kind: "invalid", issue: "missing" });
  assert.deepEqual(readGa4ProxyConfig(env({ GA4_PROXY_URL: "" })), { kind: "invalid", issue: "missing" });
  assert.deepEqual(readGa4ProxyConfig(env({ GA4_PROPERTY_ID: "" })), { kind: "invalid", issue: "missing" });
  assert.deepEqual(readGa4ProxyConfig(env({ GA4_PROPERTY_ID: "G-GYSZ7DQ1D1" })), { kind: "invalid", issue: "property_id_format" });
  for (const url of ["http://ga4-proxy-abc.a.run.app", "not a url", "https://user:pw@ga4-proxy-abc.a.run.app", "https://ga4-proxy-abc.a.run.app/?x=1", "ftp://example.test"]) {
    assert.deepEqual(readGa4ProxyConfig(env({ GA4_PROXY_URL: url })), { kind: "invalid", issue: "proxy_config" }, url);
  }
  assert.deepEqual(readGa4ProxyConfig(env({ GA4_PROXY_SECRET: "too-short" })), { kind: "invalid", issue: "proxy_config" });
  assert.deepEqual(readGa4ProxyConfig(env()), { kind: "ok", config: { propertyId: PROPERTY_ID, baseUrl: "https://ga4-proxy-abc.a.run.app", secret: SECRET } });
  const local = readGa4ProxyConfig(env({ GA4_PROXY_URL: "http://127.0.0.1:8080" }));
  assert.equal(local.kind, "ok", "ローカルのテスト用に 127.0.0.1 の http は許可");
});

await test("3. 署名：Cloudflare側（WebCrypto）で作った署名を、中継側（node:crypto）の計算と照合できる", async () => {
  const body = JSON.stringify(REPORT_BODY);
  const headers = await signProxyRequest(SECRET, "/v1/runReport", body, NOW_S, "fixed_nonce_value_0001");
  const expected = signCanonical(SECRET, canonicalString({ timestamp: String(NOW_S), nonce: "fixed_nonce_value_0001", path: "/v1/runReport", bodyHash: sha256Hex(body) }));
  assert.equal(headers["X-Ga4-Proxy-Signature"], expected);
  assert.equal(headers["X-Ga4-Proxy-Timestamp"], String(NOW_S));
  const a = await signProxyRequest(SECRET, "/v1/runReport", body, NOW_S);
  const b = await signProxyRequest(SECRET, "/v1/runReport", body, NOW_S);
  assert.notEqual(a["X-Ga4-Proxy-Nonce"], b["X-Ga4-Proxy-Nonce"], "nonce は毎回変わる");
  assert.match(a["X-Ga4-Proxy-Nonce"], /^[A-Za-z0-9_-]{16,64}$/);
  assertNoSecrets(JSON.stringify(a), "署名ヘッダー");
});

// ---- 中継の動作 ----

await test("4. 正しい署名：プロパティIDを固定してGA4へ転送し、鍵なしのトークン（メタデータサーバー・読み取り専用スコープ）を使い回す", async () => {
  const google = fakeGoogle();
  const proxy = createProxy(baseConfig(), { fetch: google.fetchFn, now: () => NOW, log: () => {} });
  const first = await proxy.handle(await signed("/v1/runReport", REPORT_BODY));
  assert.equal(first.status, 200);
  assert.deepEqual(JSON.parse(first.body), FIXTURE_EVENTS, "GA4の応答をそのまま返す（数値を作らない）");
  const second = await proxy.handle(await signed("/v1/batchRunReports", { requests: [REPORT_BODY] }));
  assert.equal(second.status, 200);
  const metadata = google.calls.filter((c) => c.url.startsWith(METADATA_URL));
  assert.equal(metadata.length, 1, "トークンは期限前まで使い回す");
  assert.equal(metadata[0].headers.get("metadata-flavor"), "Google");
  assert.equal(new URL(metadata[0].url).searchParams.get("scopes"), GA4_SCOPE);
  const data = google.dataCalls();
  assert.deepEqual(data.map((c) => c.url), [`${DATA_API_BASE}${PROPERTY_ID}:runReport`, `${DATA_API_BASE}${PROPERTY_ID}:batchRunReports`]);
  assert.equal(data[0].headers.get("authorization"), `Bearer ${ACCESS_TOKEN}`);
});

await test("5. 不正な呼び出しは401で、GA4もメタデータサーバーも呼ばない（署名なし・別のシークレット・改ざん・期限切れ・再送）", async () => {
  const google = fakeGoogle();
  const lines: string[] = [];
  const proxy = createProxy(baseConfig(), { fetch: google.fetchFn, now: () => NOW, log: (e: unknown) => lines.push(JSON.stringify(e)) });
  const good = await signed("/v1/runReport", REPORT_BODY, { nonce: "replay_nonce_value_0001" });
  const cases: [string, { method: string; path: string; headers: Record<string, string>; body: string }][] = [
    ["署名なし", { method: "POST", path: "/v1/runReport", headers: {}, body: JSON.stringify(REPORT_BODY) }],
    ["別のシークレット", await signed("/v1/runReport", REPORT_BODY, { secret: "attacker-secret-0123456789-abcdefghij" })],
    ["本文の改ざん", { ...good, body: JSON.stringify({ ...REPORT_BODY, limit: 999 }) }],
    ["メソッドの差し替え", { ...good, path: "/v1/batchRunReports" }],
    ["121秒前の時刻", await signed("/v1/runReport", REPORT_BODY, { nowS: NOW_S - 121 })],
    ["121秒先の時刻", await signed("/v1/runReport", REPORT_BODY, { nowS: NOW_S + 121 })],
    ["署名の形式違い", { ...good, headers: { ...good.headers, "x-ga4-proxy-signature": "v1=zz" } }],
    ["nonce の形式違い", { ...good, headers: { ...good.headers, "x-ga4-proxy-nonce": "short" } }],
  ];
  for (const [label, request] of cases) {
    const result = await proxy.handle(request);
    assert.equal(result.status, 401, label);
    assert.deepEqual(JSON.parse(result.body), { error: "unauthorized" }, `${label}：理由は返さない`);
  }
  assert.equal(google.calls.length, 0);
  assert.equal((await proxy.handle(good)).status, 200, "正しいものは通る");
  const replay = await proxy.handle(good);
  assert.equal(replay.status, 401, "同じ nonce の再送は拒否");
  assert.equal(google.dataCalls().length, 1);
  // 120秒ちょうどのずれは許容
  assert.equal((await proxy.handle(await signed("/v1/runReport", REPORT_BODY, { nowS: NOW_S - 120 }))).status, 200);
  // ログは1分に1件だけ（大量の不正アクセスでログが膨らまない）
  assert.equal(lines.filter((l) => l.includes("ga4-proxy-rejected")).length, 1);
  assertNoSecrets(lines.join("\n"), "ログ");
});

await test("6. 転送できるのは runReport・batchRunReports の POST だけ。/health-check は中身を返さない", async () => {
  const google = fakeGoogle();
  const proxy = createProxy(baseConfig(), { fetch: google.fetchFn, now: () => NOW, log: () => {} });
  assert.deepEqual(await proxy.handle({ method: "GET", path: "/health-check", headers: {}, body: "" }), { status: 204, body: "" });
  // /healthz は Cloud Run の予約パス（コンテナに届かない）なので、中継でも使わない
  assert.equal((await proxy.handle({ method: "GET", path: "/healthz", headers: {}, body: "" })).status, 404);
  for (const path of ["/v1/runPivotReport", "/v1/runRealtimeReport", "/v1/getMetadata", "/", "/v1/runReport/x"]) {
    assert.equal((await proxy.handle(await signed(path, REPORT_BODY))).status, 404, path);
  }
  assert.equal((await proxy.handle({ ...(await signed("/v1/runReport", REPORT_BODY)), method: "GET" })).status, 404);
  assert.equal(google.calls.length, 0);
});

await test("7. 本文の確認：別のプロパティの指定・大きすぎる要求・壊れたJSONは400／413", async () => {
  const google = fakeGoogle();
  const proxy = createProxy(baseConfig(), { fetch: google.fetchFn, now: () => NOW, log: () => {} });
  const bad: [string, unknown][] = [
    ["プロパティの指定", { ...REPORT_BODY, property: "properties/999" }],
    ["batch内のプロパティ", { requests: [{ ...REPORT_BODY, property: "properties/999" }] }],
    ["batchが6件", { requests: Array.from({ length: 6 }, () => REPORT_BODY) }],
    ["batchが0件", { requests: [] }],
    ["batchに余計な項目", { requests: [REPORT_BODY], property: "properties/999" }],
    ["limit が上限超え", { ...REPORT_BODY, limit: 5000 }],
    ["配列", [REPORT_BODY]],
    ["壊れたJSON", "{not json"],
  ];
  for (const [label, body] of bad) {
    const path = label.startsWith("batch") ? "/v1/batchRunReports" : "/v1/runReport";
    assert.equal((await proxy.handle(await signed(path, body))).status, 400, label);
  }
  assert.equal((await proxy.handle(await signed("/v1/runReport", "x".repeat(MAX_BODY_BYTES + 1)))).status, 413);
  assert.equal(google.calls.length, 0);
  assert.equal(validateReportBody("runReport", REPORT_BODY), true);
});

await test("8. レート制限：署名が正しいものを1分・1日ごとに数え、超えたら429（GA4を呼ばない）", async () => {
  let now = NOW;
  const google = fakeGoogle();
  const proxy = createProxy(baseConfig({ PROXY_RATE_PER_MINUTE: "3", PROXY_RATE_PER_DAY: "5" }), { fetch: google.fetchFn, now: () => now, log: () => {} });
  const send = async () => (await proxy.handle(await signed("/v1/runReport", REPORT_BODY, { nowS: Math.floor(now / 1000) }))).status;
  assert.deepEqual([await send(), await send(), await send(), await send()], [200, 200, 200, 429]);
  now += 60_000;
  assert.deepEqual([await send(), await send(), await send()], [200, 200, 429], "1日の上限（5件）");
  assert.equal(google.dataCalls().length, 5);
  // 不正な署名は数えない（正しい呼び出しを締め出せない）
  const limiter = new RateLimiter(2, 10);
  assert.deepEqual([limiter.take(NOW), limiter.take(NOW), limiter.take(NOW), limiter.take(NOW + 60_000)], [true, true, false, true]);
});

await test("9. GA4・メタデータサーバーの失敗は種類だけを返し、Googleのエラー本文・トークンを出さない", async () => {
  for (const [options, status, kind] of [
    [{ dataStatus: 403 }, 502, "upstream_forbidden"],
    [{ dataStatus: 401 }, 502, "upstream_forbidden"],
    [{ dataStatus: 429 }, 429, "upstream_rate_limited"],
    [{ dataStatus: 500 }, 502, "upstream_error"],
    [{ dataStatus: 400 }, 502, "upstream_error"],
    [{ metadataStatus: 404 }, 502, "token_unavailable"],
    [{ networkDown: true }, 502, "token_unavailable"],
  ] as const) {
    const lines: string[] = [];
    const proxy = createProxy(baseConfig(), { fetch: fakeGoogle(options).fetchFn, now: () => NOW, log: (e: unknown) => lines.push(JSON.stringify(e)) });
    const result = await proxy.handle(await signed("/v1/runReport", REPORT_BODY));
    assert.equal(result.status, status, kind);
    // 呼び出し元へは、エラーの種類と GA4 の状態コードだけ（Google のエラー本文は返さない）
    const upstreamStatus = "dataStatus" in options ? options.dataStatus : undefined;
    assert.deepEqual(JSON.parse(result.body), upstreamStatus ? { error: kind, upstreamStatus } : { error: kind });
    assert.ok(lines.some((l) => l.includes(kind)));
    assertNoSecrets(result.body, `${kind} の応答`);
    if (upstreamStatus === 400) {
      // 400（要求の内容の誤り）だけは、原因を調べられるよう Cloud Run のログに短い説明文を残す（トークン・シークレットは出さない）
      assert.equal(JSON.parse(lines.find((l) => l.includes(kind))!).message, GOOGLE_ERROR_BODY);
      for (const secret of [SECRET, OLD_SECRET, ACCESS_TOKEN]) assert.ok(!lines.join("\n").includes(secret));
    } else {
      assertNoSecrets(lines.join("\n"), `${kind} のログ`);
    }
  }
});

await test("9b. GA4 のエラーの要約：種類は常に、説明文は 400 のときだけ。長い英数字（トークンらしきもの）は伏せ、200文字で切る", async () => {
  const token = `ya29.${"A".repeat(60)}`;
  const body = (status: number, message: string) =>
    new Response(JSON.stringify({ error: { code: status, status: "INVALID_ARGUMENT", message } }), { status });
  const summary = await googleErrorSummary(body(400, `Field customEvent:content_type is not a valid dimension. ${token} ${"x ".repeat(300)}`));
  assert.equal(summary.googleStatus, "INVALID_ARGUMENT");
  assert.ok(summary.message!.startsWith("Field customEvent:content_type is not a valid dimension."));
  assert.ok(!summary.message!.includes(token) && summary.message!.includes("[省略]"));
  assert.ok(summary.message!.length <= GOOGLE_ERROR_MESSAGE_MAX);
  assert.deepEqual(await googleErrorSummary(body(403, "User does not have sufficient permissions")), { googleStatus: "INVALID_ARGUMENT" });
  assert.deepEqual(await googleErrorSummary(new Response("<html>not json</html>", { status: 500 })), {});
});

await test("10. シークレットの切り替え：PREVIOUS に入れた古いシークレットでも受け付ける", async () => {
  const proxy = createProxy(baseConfig({ PROXY_HMAC_SECRET_PREVIOUS: OLD_SECRET }), { fetch: fakeGoogle().fetchFn, now: () => NOW, log: () => {} });
  assert.equal((await proxy.handle(await signed("/v1/runReport", REPORT_BODY, { secret: OLD_SECRET }))).status, 200);
  assert.equal((await proxy.handle(await signed("/v1/runReport", REPORT_BODY))).status, 200);
});

await test("11. nonce の記録：期限が過ぎたものは消え、上限に達したら安全側（拒否）に倒す", () => {
  const store = new NonceStore(1000, 2);
  assert.equal(store.use("a".repeat(16), 0), true);
  assert.equal(store.use("a".repeat(16), 500), false);
  assert.equal(store.use("b".repeat(16), 500), true);
  assert.equal(store.use("c".repeat(16), 600), false, "上限（2件）");
  assert.equal(store.use("c".repeat(16), 1600), true, "期限切れが消えて記録できる");
});

// ---- 実際のHTTPで、Cloudflare側 → 中継 → 偽物のGoogle ----

async function startProxy(google: ReturnType<typeof fakeGoogle>, extra: Record<string, unknown> = {}) {
  const lines: string[] = [];
  const server = createProxyServer(baseConfig(extra), { fetch: google.fetchFn, now: () => NOW, log: (e: unknown) => lines.push(JSON.stringify(e)) });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return { url, lines, close: () => new Promise<void>((resolve) => server.close(() => resolve())) };
}

const range7 = () => parseAnalyticsRange(new URLSearchParams("range=7d"), new Date(NOW))!;
const cfEnv = (url: string, extra: Record<string, unknown> = {}) => ({ GA4_PROPERTY_ID: PROPERTY_ID, GA4_PROXY_URL: url, GA4_PROXY_SECRET: SECRET, ...extra });

await test("12. 通しの確認：アクセス解析は中継経由でGA4の実データ（ここでは架空の値）をそのまま集計し、2回目はキャッシュ", async () => {
  const google = fakeGoogle();
  const proxy = await startProxy(google);
  const proxyCalls: string[] = [];
  const deps = { now: () => NOW, fetch: (input: string, init?: RequestInit) => (proxyCalls.push(String(input)), fetch(input, init)) };
  try {
    const env = cfEnv(proxy.url, { GA4_SERVICE_ACCOUNT_EMAIL: "ignored@test.iam.gserviceaccount.com", GA4_SERVICE_ACCOUNT_PRIVATE_KEY: "ignored" });
    const result = (await getAnalyticsReport(env, range7(), deps)) as Extract<AnalyticsApiResponse, { cached: boolean }>;
    assert.equal(result.ok, true);
    assert.equal(result.configured, true);
    assert.equal(result.cached, false);
    assert.deepEqual(result.report.totals.current, { pageViews: 1200, users: 300, sessions: 450 });
    assert.deepEqual(result.report.totals.previous, { pageViews: 1000, users: 250, sessions: 400 });
    assert.equal(result.report.contentTypeAvailable, true);
    assert.equal(result.report.formResponses, "unlinked", "フォームの回答数は今まで通り「未連携」");
    assert.deepEqual(proxyCalls.map((u) => new URL(u).pathname).sort(), ["/v1/batchRunReports", "/v1/runReport", "/v1/runReport"]);
    assert.ok(!google.calls.some((c) => c.url.includes("oauth2.googleapis.com")), "中継方式では鍵方式のトークン発行先を使わない");
    const again = (await getAnalyticsReport(env, range7(), deps)) as Extract<AnalyticsApiResponse, { cached: boolean }>;
    assert.equal(again.cached, true);
    assert.equal(proxyCalls.length, 3, "2回目は中継を呼ばない");
  } finally {
    await proxy.close();
  }
});

await test("13. 通しの確認：設置場所（content_type）が未登録でも、イベント名だけの集計で続ける", async () => {
  const proxy = await startProxy(fakeGoogle({ typeStatus: 400 }));
  try {
    const result = (await getAnalyticsReport(cfEnv(proxy.url), range7(), { now: () => NOW })) as Extract<AnalyticsApiResponse, { cached: boolean }>;
    assert.equal(result.ok, true);
    assert.equal(result.report.contentTypeAvailable, false);
  } finally {
    await proxy.close();
  }
});

await test("14. 通しの確認：認証失敗・GA4の失敗・中継が止まっているときは「unavailable」だけ（数値なし・ログは種類だけ）", async () => {
  // ログには種類に加えて、中継の状態コード・中継のエラーの種類・GA4 の状態コード・どの要求か（method）を残す（原因を切り分けるため）
  const cases: [string, ReturnType<typeof fakeGoogle>, Record<string, unknown>, string, Record<string, unknown>, string?][] = [
    ["シークレットが違う", fakeGoogle(), { GA4_PROXY_SECRET: "wrong-secret-0123456789-abcdefghijklmn" }, "proxy_rejected", { status: 401, proxyError: "unauthorized" }],
    ["GA4の閲覧権限が無い", fakeGoogle({ dataStatus: 403 }), {}, "api_forbidden", { status: 502, proxyError: "upstream_forbidden", upstreamStatus: 403 }],
    ["メタデータサーバーの失敗", fakeGoogle({ metadataStatus: 500 }), {}, "api_forbidden", { status: 502, proxyError: "token_unavailable" }],
    ["GA4の上限", fakeGoogle({ dataStatus: 429 }), {}, "rate_limited", { status: 429, proxyError: "upstream_rate_limited", upstreamStatus: 429 }],
    ["GA4の障害", fakeGoogle({ dataStatus: 500 }), {}, "api_error", { status: 502, proxyError: "upstream_error", upstreamStatus: 500 }],
    ["URL のパスの誤り", fakeGoogle(), {}, "api_error", { status: 404, proxyError: "empty_body" }, "/wrong-path"],
  ];
  for (const [label, google, extra, kind, detail, suffix] of cases) {
    resetGa4Caches();
    logs.lines.length = 0;
    const proxy = await startProxy(google);
    try {
      const result = await getAnalyticsReport(cfEnv(proxy.url + (suffix ?? ""), extra), range7(), { now: () => NOW });
      assert.deepEqual(result, { ok: false, configured: true, error: "unavailable" }, label);
      assert.equal(logs.lines.length, 1, label);
      const { method, ...logged } = JSON.parse(logs.lines[0]);
      assert.deepEqual(logged, { event: "ga4-analytics-error", kind, ...detail }, label);
      assert.ok(method === "batchRunReports" || method === "runReport", label);
      assertNoSecrets(JSON.stringify(result) + logs.lines.join("\n") + proxy.lines.join("\n"), label);
    } finally {
      await proxy.close();
    }
  }
  // 中継が止まっている（接続できない）
  resetGa4Caches();
  logs.lines.length = 0;
  const stopped = await startProxy(fakeGoogle());
  await stopped.close();
  const down = await getAnalyticsReport(cfEnv(stopped.url), range7(), { now: () => NOW });
  assert.deepEqual(down, { ok: false, configured: true, error: "unavailable" });
  assert.equal(JSON.parse(logs.lines.at(-1)!).kind, "network_error");
  assert.equal(JSON.parse(logs.lines.at(-1)!).cause, "fetch_failed");
});

await test("14b. 中継の応答の読み取り：JSON でない応答・空の応答・GA4 の状態コードを区別し、許可した形の値だけを残す", async () => {
  assert.deepEqual(await proxyErrorInfo(new Response("<html>Error: Server Error</html>", { status: 503 })), { kind: "api_error", status: 503, proxyError: "non_json" });
  assert.deepEqual(await proxyErrorInfo(new Response(null, { status: 404 })), { kind: "api_error", status: 404, proxyError: "empty_body" });
  assert.deepEqual(await proxyErrorInfo(new Response(JSON.stringify({ error: "upstream_error", upstreamStatus: 400 }), { status: 502 })), {
    kind: "api_error",
    status: 502,
    proxyError: "upstream_error",
    upstreamStatus: 400,
  });
  assert.deepEqual(await proxyErrorInfo(new Response(JSON.stringify({ error: "bad_request" }), { status: 400 })), { kind: "api_error", status: 400, proxyError: "bad_request" });
  // 想定外の形の値（長い文字列・記号入り）はログに残さない
  assert.deepEqual(await proxyErrorInfo(new Response(JSON.stringify({ error: `token ${SECRET}`, upstreamStatus: "x" }), { status: 502 })), { kind: "api_error", status: 502 });
  assert.equal((await proxyErrorInfo(new Response(JSON.stringify({ error: "upstream_unreachable" }), { status: 502 }))).kind, "network_error");
});

await test("14c. 中継が15秒で応答しないときは network_error（cause: timeout）。プログラムの例外は cause: exception と例外の名前だけ", async () => {
  resetGa4Caches();
  logs.lines.length = 0;
  const timeoutFetch = async () => {
    throw new DOMException("The operation was aborted due to timeout", "TimeoutError");
  };
  await getAnalyticsReport(cfEnv("https://ga4-proxy-abc.a.run.app"), range7(), { now: () => NOW, fetch: timeoutFetch });
  const timeoutLog = JSON.parse(logs.lines.at(-1)!);
  assert.equal(timeoutLog.kind, "network_error");
  assert.equal(timeoutLog.cause, "timeout");
  // 中継は 200 を返したが、中身の形が想定外で組み立てに失敗した（プログラムの例外）
  resetGa4Caches();
  logs.lines.length = 0;
  const broken = async () => Response.json({ reports: [{ rows: 5 }], rows: 5 });
  const result = await getAnalyticsReport(cfEnv("https://ga4-proxy-abc.a.run.app"), range7(), { now: () => NOW, fetch: broken });
  assert.deepEqual(result, { ok: false, configured: true, error: "unavailable" });
  const exceptionLog = JSON.parse(logs.lines.at(-1)!);
  assert.deepEqual(exceptionLog, { event: "ga4-analytics-error", kind: "api_error", cause: "exception", name: "TypeError" });
});

await test("15. 通しの確認：中継の設定が足りない・形式違いのときは通信せず未設定（設定手順だけを表示）", async () => {
  const calls: string[] = [];
  const deps = { now: () => NOW, fetch: async (input: string) => (calls.push(input), new Response("{}")) };
  assert.deepEqual(await getAnalyticsReport({ GA4_PROPERTY_ID: PROPERTY_ID, GA4_PROXY_URL: "https://ga4-proxy-abc.a.run.app" }, range7(), deps), {
    ok: true,
    configured: false,
    issue: "missing",
  });
  assert.deepEqual(await getAnalyticsReport(cfEnv("http://ga4-proxy-abc.a.run.app"), range7(), deps), { ok: true, configured: false, issue: "proxy_config" });
  assert.deepEqual(await getAnalyticsReport(cfEnv("https://ga4-proxy-abc.a.run.app", { GA4_PROPERTY_ID: "G-GYSZ7DQ1D1" }), range7(), deps), {
    ok: true,
    configured: false,
    issue: "property_id_format",
  });
  assert.deepEqual(await getAnalyticsReport({}, range7(), deps), { ok: true, configured: false, issue: "missing" }, "何も無ければ今まで通り未設定");
  assert.equal(calls.length, 0);
});

await test("16. HTTPの入口：大きすぎる本文は413、応答はキャッシュさせない・中身の推測をさせないヘッダー付き", async () => {
  const proxy = await startProxy(fakeGoogle());
  try {
    const big = await fetch(`${proxy.url}/v1/runReport`, { method: "POST", body: "x".repeat(MAX_BODY_BYTES + 10), headers: { "content-type": "application/json" } });
    assert.equal(big.status, 413);
    await big.body?.cancel();
    const unauth = await fetch(`${proxy.url}/v1/runReport`, { method: "POST", body: "{}" });
    assert.equal(unauth.status, 401);
    assert.equal(unauth.headers.get("cache-control"), "no-store");
    assert.equal(unauth.headers.get("x-content-type-options"), "nosniff");
    assert.equal(unauth.headers.get("access-control-allow-origin"), null, "ブラウザから直接呼べない（CORSを許可しない）");
    await unauth.body?.cancel();
    const health = await fetch(`${proxy.url}/health-check`);
    assert.equal(health.status, 204);
    const notFound = await fetch(`${proxy.url}/anything`);
    assert.equal(notFound.status, 404);
    assert.equal(await notFound.text(), "");
  } finally {
    await proxy.close();
  }
});

// ---- Google Cloud の無料トライアル終了の案内 ----

await test("17. 無料トライアルの案内：終了日までは残り日数、30日前から注意、終了後は「止まっている」案内（数値は出さない）", () => {
  const trial = { plan: "free_trial" as const, freeTrialEndsOn: "2026-12-31", warnDaysBefore: 30 };
  assert.equal(japaneseDate("2026-12-31"), "2026年12月31日");
  const early = relayHostingNotice(trial, "2026-11-09")!;
  assert.equal(early.level, "info");
  assert.match(early.title, /2026年12月31日（あと52日）に終了/);
  assert.ok(early.lines.some((l) => l.includes("データを取得できなくなります")));
  assert.ok(early.lines.some((l) => l.includes("残高（クレジット）を使い切った場合")));
  assert.equal(relayHostingNotice(trial, "2026-11-30")!.level, "info");
  assert.equal(relayHostingNotice(trial, "2026-12-01")!.level, "warning", "30日前から注意");
  assert.match(relayHostingNotice(trial, "2026-12-31")!.title, /本日に終了/);
  const ended = relayHostingNotice(trial, "2027-01-01")!;
  assert.equal(ended.level, "ended");
  assert.match(ended.title, /2026年12月31日に終了しました/);
  assert.ok(ended.lines.some((l) => l.includes("数値は表示されません")));
  assert.equal(relayHostingNotice({ ...trial, plan: "paid" }, "2027-01-01"), null, "有料に切り替えたら案内しない");
  assert.equal(relayHostingNotice({ ...trial, plan: null }, "2026-11-09"), null);
  assert.equal(relayHostingNotice({ ...trial, freeTrialEndsOn: "12/31" }, "2026-11-09"), null, "日付の形式が違うときは案内しない");
  assert.deepEqual(analyticsRelayHosting, trial, "現在の設定：無料トライアル・2026年12月31日終了");
  for (const line of [early.title, ...early.lines, ended.title, ...ended.lines]) assert.ok(!/d+(回|人|件)/.test(line), "案内に数値（アクセス数など）を含めない");
});

await test("18. 画面：案内の枠があり、設定済みの状態（表示中・未取得）のときだけ表示する", () => {
  const page = readFileSync("src/pages/staff/analytics/index.astro", "utf8");
  assert.match(page, /data-relay-notice role="note" class="hidden/);
  assert.match(page, /無料トライアルが終了していないか/);
  const script = readFileSync("src/scripts/staff/analytics.ts", "utf8");
  assert.match(script, /updateRelayNotice(state === "content" || state === "unavailable")/);
  assert.ok(!/innerHTML/.test(script.slice(script.indexOf("function updateRelayNotice"))), "案内は textContent で表示する");
});

// ---- Cloud Shell の導入スクリプト（services/ga4-proxy/scripts） ----

const RELAY_DIR = "services/ga4-proxy";

/** 子プロセスを非同期で実行する（同じプロセスの中継サーバーが応答できるように、spawnSync は使わない） */
function runNode(args: string[], env: Record<string, string> = {}) {
  return new Promise<{ code: number | null; out: string }>((resolve) => {
    const child = spawn(process.execPath, args, { env: { PATH: process.env.PATH ?? "", ...env }, stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (out += d));
    child.on("close", (code) => resolve({ code, out }));
  });
}

/** 実際の時刻で動く中継（remote-check は現在時刻で署名するため） */
async function startRealtimeProxy(google: ReturnType<typeof fakeGoogle>, secret = SECRET) {
  const setting = readProxyConfig({ GA4_PROPERTY_ID: "546942310", PROXY_HMAC_SECRET: secret, PROXY_METADATA_TOKEN_URL: METADATA_URL });
  assert.ok(setting.ok);
  const server = createProxyServer(setting.config, { fetch: google.fetchFn, log: () => {} });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return { url, close: () => new Promise<void>((resolve) => server.close(() => resolve())) };
}

await test("19. 自己テスト（selftest.mjs）：Googleに接続せず、署名・再送・レート制限などをすべて確認して成功する", async () => {
  const result = await runNode([`${RELAY_DIR}/scripts/selftest.mjs`]);
  assert.equal(result.code, 0, result.out);
  assert.match(result.out, /自己テスト：すべて合格/);
  assert.ok(!/^NG/m.test(result.out));
});

await test("20. 公開後の確認（remote-check.mjs）：安全性の確認が通り、GA4の数値（ここでは架空の値）を表示。シークレットは出さない", async () => {
  const proxy = await startRealtimeProxy(fakeGoogle());
  try {
    const result = await runNode([`${RELAY_DIR}/scripts/remote-check.mjs`, proxy.url], { PROXY_TEST_SECRET: SECRET });
    assert.equal(result.code, 0, result.out);
    for (const label of ["署名なしは拒否", "別のシークレットは拒否", "10分前の署名は拒否", "対象外のメソッドは 404", "同じ要求の再送は拒否", "GA4 Data API に接続できました"]) {
      assert.match(result.out, new RegExp(`OK  ${label}`), label);
    }
    assert.match(result.out, /過去 7日/);
    assert.match(result.out, /過去90日/);
    assert.match(result.out, /申込の完了数ではありません/);
    assert.ok(!result.out.includes(SECRET), "シークレットを表示しない");
    assert.ok(!result.out.includes(ACCESS_TOKEN), "トークンを表示しない");
  } finally {
    await proxy.close();
  }
});

await test("21. 公開後の確認：シークレットが違えば終了コード2（setup.sh は公開を止める）、GA4の権限が無ければ終了コード3", async () => {
  const mismatch = await startRealtimeProxy(fakeGoogle(), OLD_SECRET);
  try {
    const result = await runNode([`${RELAY_DIR}/scripts/remote-check.mjs`, mismatch.url], { PROXY_TEST_SECRET: SECRET });
    assert.equal(result.code, 2, result.out);
    assert.match(result.out, /NG  正しい署名は受け付ける/);
  } finally {
    await mismatch.close();
  }
  const forbidden = await startRealtimeProxy(fakeGoogle({ dataStatus: 403 }));
  try {
    const result = await runNode([`${RELAY_DIR}/scripts/remote-check.mjs`, forbidden.url], { PROXY_TEST_SECRET: SECRET });
    assert.equal(result.code, 3, result.out);
    assert.match(result.out, /閲覧者/);
    assert.ok(!result.out.includes(GOOGLE_ERROR_BODY), "Googleのエラー本文を表示しない");
  } finally {
    await forbidden.close();
  }
  const usage = await runNode([`${RELAY_DIR}/scripts/remote-check.mjs`, "http://example.test"], { PROXY_TEST_SECRET: "short" });
  assert.equal(usage.code, 1);
});

await test("22. 組織ポリシーの判定：東京・ingress=all・必要なAPIを妨げるものだけを NG にする", () => {
  assert.equal(evaluatePolicy("iam.disableServiceAccountKeyCreation", { booleanPolicy: { enforced: true } })[0], "OK");
  assert.equal(evaluatePolicy("iam.automaticIamGrantsForDefaultServiceAccounts", { booleanPolicy: { enforced: true } })[0], "OK");
  assert.equal(evaluatePolicy("iam.allowedPolicyMemberDomains", { listPolicy: { allowedValues: ["C0123"] } })[0], "OK");
  assert.equal(evaluatePolicy("gcp.resourceLocations", {})[0], "OK");
  assert.equal(evaluatePolicy("gcp.resourceLocations", { listPolicy: { allowedValues: ["in:asia-locations"] } })[0], "OK");
  assert.equal(evaluatePolicy("gcp.resourceLocations", { listPolicy: { allowedValues: ["in:jp-locations"] } })[0], "OK");
  assert.equal(evaluatePolicy("gcp.resourceLocations", { listPolicy: { allowedValues: ["in:us-locations"] } })[0], "NG");
  assert.equal(evaluatePolicy("gcp.resourceLocations", { listPolicy: { deniedValues: ["in:asia-northeast1-locations"] } })[0], "NG");
  assert.equal(evaluatePolicy("run.allowedIngress", { listPolicy: { allowedValues: ["internal"] } })[0], "NG");
  assert.equal(evaluatePolicy("run.allowedIngress", { listPolicy: { allowedValues: ["all", "internal"] } })[0], "OK");
  assert.equal(evaluatePolicy("gcp.restrictServiceUsage", { listPolicy: { deniedValues: ["run.googleapis.com"] } })[0], "NG");
  assert.equal(evaluatePolicy("gcp.restrictNonCmekServices", { listPolicy: { deniedValues: ["secretmanager.googleapis.com"] } })[0], "NG");
  assert.equal(evaluatePolicy("run.allowedBinaryAuthorizationPolicies", { listPolicy: { allowedValues: ["default"] } })[0], "NG");
  assert.equal(evaluatePolicy("constraints/run.allowedIngress", {})[0], "OK", "constraints/ 付きの名前も受け付ける");
});

await test("23. Cloud Run の設定の判定：最大1・最小0・リクエスト単位のCPU・256Mi・GA4用サービスアカウント・シークレットは Secret Manager", () => {
  const SA = "ga4-analytics-reader@nobeoka-ugokasu-staff.iam.gserviceaccount.com";
  const good = {
    metadata: { annotations: { "run.googleapis.com/ingress": "all" } },
    spec: {
      template: {
        metadata: { annotations: { "autoscaling.knative.dev/maxScale": "1", "run.googleapis.com/cpu-throttling": "true" } },
        spec: {
          serviceAccountName: SA,
          timeoutSeconds: 15,
          containers: [
            {
              resources: { limits: { memory: "256Mi", cpu: "1" } },
              env: [
                { name: "GA4_PROPERTY_ID", value: "546942310" },
                { name: "PROXY_HMAC_SECRET", valueFrom: { secretKeyRef: { name: "ga4-proxy-hmac", key: "latest" } } },
              ],
            },
          ],
        },
      },
    },
  };
  assert.equal(evaluateService(SA, good)[0], "OK");
  const bad = structuredClone(good);
  bad.spec.template.metadata.annotations["autoscaling.knative.dev/maxScale"] = "100";
  bad.spec.template.metadata.annotations["run.googleapis.com/cpu-throttling"] = "false";
  (bad.spec.template.spec.containers[0].env[1] as Record<string, unknown>) = { name: "PROXY_HMAC_SECRET", value: "plain" };
  const [status, text] = evaluateService(SA, bad);
  assert.equal(status, "NG");
  assert.match(text, /最大インスタンス数/);
  assert.match(text, /CPUが常時割り当て/);
  assert.match(text, /環境変数に直接書かれている/);
  assert.ok(!text.includes("plain"), "判定結果に値を含めない");
});

await test("24. setup.sh：変更はすべて1回の承認（yes）の後。鍵の作成・APIの有効化・課金の変更・シークレットの表示をしない", () => {
  const setup = readFileSync(`${RELAY_DIR}/scripts/setup.sh`, "utf8").replace(/\r\n/g, "\n");
  const code = setup
    .split("\n")
    .filter((line) => !line.trim().startsWith("#"))
    .join("\n");
  const approval = code.indexOf('read -r -p "上の変更を実行しますか');
  assert.ok(approval > 0, "承認の確認がある");
  assert.equal(code.split('read -r -p "上の変更を実行しますか').length - 1, 1, "承認は1回だけ");
  for (const mutation of [
    "gcloud secrets create",
    "gcloud secrets versions add",
    "add-iam-policy-binding",
    "gcloud iam service-accounts create",
    "gcloud artifacts repositories create",
    "set-cleanup-policies",
    "gcloud builds submit",
    "gcloud run deploy",
    "gcloud logging sinks update",
    "gcloud run services update",
  ]) {
    const at = code.indexOf(mutation);
    assert.ok(at > approval, `${mutation} は承認の後だけ`);
  }
  for (const forbidden of ["keys create", "services enable", "billing projects link", "org-policies set-policy", "orgpolicy", "set -x", "echo $PROXY_TEST_SECRET", "echo \"$PROXY_TEST_SECRET"]) {
    assert.ok(!code.includes(forbidden), `使わない: ${forbidden}`);
  }
  assert.match(code, /gcloud resource-manager org-policies describe/, "組織ポリシーは従来の Resource Manager API で読む");
  assert.match(code, /CLOUDSDK_CORE_DISABLE_PROMPTS=1/, "APIの有効化の確認で止まらない");
  assert.match(code, /rec 未確認 "組織ポリシー \$c"/, "読めない制約は未確認として続行");
  assert.match(code, /--check-only/);
  for (const flag of ["--min-instances=0", "--max-instances=1", "--cpu-throttling", "--no-cpu-boost", "--memory=256Mi", "--no-invoker-iam-check", "--set-secrets=", "--ingress=internal"]) {
    assert.ok(code.includes(flag), flag);
  }
  assert.ok(!/--set-env-vars="[^"]*PROXY_HMAC_SECRET/.test(code), "シークレットを環境変数に直接書かない");
  assert.match(code, /--set-secrets="PROXY_HMAC_SECRET=\$\{SECRET_NAME\}:latest"/, "シークレットは Secret Manager から渡す");
  assert.ok(!/PROXY_TEST_SECRET[^\n]*>>?\s*"?\$REPORT/.test(code), "シークレットをレポートに書かない");
  const show = readFileSync(`${RELAY_DIR}/scripts/show-secret.sh`, "utf8");
  assert.match(show, />\/dev\/tty/, "シークレットは端末にだけ表示（ファイル・パイプに流さない）");
  assert.match(show, /yes/);
  const build = readFileSync(`${RELAY_DIR}/cloudbuild.yaml`, "utf8");
  assert.match(build, /logging: CLOUD_LOGGING_ONLY/);
  assert.ok(!/^\s*machineType/m.test(build), "既定のマシン（無料枠の対象）を使う");
  const ignore = readFileSync(`${RELAY_DIR}/.gcloudignore`, "utf8");
  assert.ok(!/!scripts/.test(ignore), "スクリプトはコンテナに入れない");
  const bash = spawnSync("bash", ["-n", `${RELAY_DIR}/scripts/setup.sh`]);
  if (!bash.error) assert.equal(bash.status, 0, "setup.sh の構文");
  const bash2 = spawnSync("bash", ["-n", `${RELAY_DIR}/scripts/show-secret.sh`]);
  if (!bash2.error) assert.equal(bash2.status, 0, "show-secret.sh の構文");
});

await test("25. 稼働確認のパスは /health-check に統一（Cloud Run は末尾が z のパスを予約しているため /healthz は使わない）。再実行でシークレットの値を変えない", () => {
  assert.equal(HEALTH_CHECK_PATH, "/health-check");
  assert.ok(!HEALTH_CHECK_PATH.endsWith("z"), "末尾が z のパスは Cloud Run の予約パス");
  // 公開後の確認（Cloud Run に接続する側）は /healthz を一切使わない
  for (const file of ["scripts/setup.sh", "scripts/remote-check.mjs"]) {
    assert.ok(!readFileSync(`${RELAY_DIR}/${file}`, "utf8").includes("/healthz"), `${file} に /healthz が残っている`);
  }
  assert.match(readFileSync(`${RELAY_DIR}/scripts/remote-check.mjs`, "utf8"), /\$\{base\}\$\{HEALTH_CHECK_PATH\}/);
  assert.match(readFileSync(`${RELAY_DIR}/src/proxy.mjs`, "utf8"), /request\.path === HEALTH_CHECK_PATH/);
  const setup = readFileSync(`${RELAY_DIR}/scripts/setup.sh`, "utf8");
  assert.match(setup, /"\$SERVICE_URL\/health-check"/);
  // 再実行：シークレットの値の登録は「シークレットが無い」か「有効な値が0件」のときだけ。既存の資源は作り直さない
  const addIndex = setup.indexOf("gcloud secrets versions add");
  const guard = setup.lastIndexOf("if [", addIndex);
  assert.ok(
    setup.slice(guard, addIndex).includes('if [ "$SECRET_EXISTS" = 0 ] || [ "${SECRET_VERSIONS:-0}" = "0" ]; then'),
    "既存のシークレットの値は変えない",
  );
  assert.equal(setup.match(/gcloud secrets versions add/g)?.length, 1);
  assert.match(setup, /if \[ "\$BUILDER_EXISTS" = 0 \]; then\r?\n\s+run "ビルド用サービスアカウントの作成"/);
  assert.match(setup, /if \[ "\$REPO_EXISTS" = 0 \]; then\r?\n\s+run "Artifact Registry の作成"/);
  assert.ok(!/service-accounts create "\$RUNTIME_SA|service-accounts create ga4-analytics-reader/.test(setup), "GA4用サービスアカウントは作らない（既存を使う）");
  assert.ok(!/run services delete|artifacts repositories delete|secrets delete|service-accounts delete/.test(setup), "既存の資源を削除しない");
});

await test("26. 診断（portal-check.mjs）が送る要求は、ポータル（server/ga4Analytics.ts）が送る要求と完全に同じ", () => {
  assert.deepEqual(PORTAL_TRACKED_EVENTS, TRACKED_EVENTS.map((e) => e.name), "イベント名の一覧");
  for (const now of [new Date("2026-11-09T15:30:00Z"), new Date("2026-12-31T14:59:00Z"), new Date("2027-01-01T00:00:00Z")]) {
    for (const key of ["today", "7d", "30d", "90d"]) {
      const range = parseAnalyticsRange(new URLSearchParams({ range: key }), now)!;
      assert.deepEqual(portalRange(key, now), range, `${key} の期間`);
      const [main, byPage, byType] = portalRequests(range);
      assert.deepEqual(main.body, buildMainBatch(range), `${key} 合計など`);
      assert.deepEqual(byPage.body, buildEventsByPageRequest(range), `${key} クリック×ページ`);
      assert.deepEqual(byType.body, buildEventsByTypeRequest(range), `${key} クリック×設置場所`);
      assert.deepEqual([main.method, byPage.method, byType.method], ["batchRunReports", "runReport", "runReport"]);
      assert.deepEqual([main.optional, byPage.optional, byType.optional], [false, false, true]);
      for (const item of [main, byPage, byType]) assert.ok(validateReportBody(item.method, item.body), `${key} は中継の本文の検査を通る`);
    }
  }
});

await test("27. 診断（portal-check.mjs）：成功・GA4 の 400・URL の誤りを区別して表示し、シークレット・トークン・Google のエラー本文は出さない", async () => {
  const ok = await startRealtimeProxy(fakeGoogle({ typeStatus: 400 }));
  try {
    const result = await runNode([`${RELAY_DIR}/scripts/portal-check.mjs`, ok.url, "30d"], { PROXY_TEST_SECRET: SECRET });
    assert.equal(result.code, 0, result.out);
    assert.match(result.out, /OK   HTTP 200 .*batchRunReports/);
    assert.match(result.out, /参考 HTTP 502 .*content_type/);
    assert.match(result.out, /upstream_error \/ GA4 400/);
    assertNoSecrets(result.out, "診断の表示");
  } finally {
    await ok.close();
  }
  const bad = await startRealtimeProxy(fakeGoogle({ dataStatus: 400 }));
  try {
    const result = await runNode([`${RELAY_DIR}/scripts/portal-check.mjs`, bad.url], { PROXY_TEST_SECRET: SECRET });
    assert.equal(result.code, 4, result.out);
    assert.match(result.out, /NG   HTTP 502 .*batchRunReports[\s\S]*upstream_error \/ GA4 400/);
    assertNoSecrets(result.out, "診断の表示");
    const wrongPath = await runNode([`${RELAY_DIR}/scripts/portal-check.mjs`, `${bad.url}/wrong-path`], { PROXY_TEST_SECRET: SECRET });
    assert.equal(wrongPath.code, 4);
    assert.match(wrongPath.out, /NG   HTTP 404/);
  } finally {
    await bad.close();
  }
  const usage = await runNode([`${RELAY_DIR}/scripts/portal-check.mjs`, "https://example.test"], {});
  assert.equal(usage.code, 1);
});

await test("28. diagnose.sh：読み取りだけ（作成・変更・削除・デプロイをしない）。シークレットは環境変数で渡すだけ", () => {
  const code = readFileSync(`${RELAY_DIR}/scripts/diagnose.sh`, "utf8");
  const commands = code.split(/\r?\n/).filter((line) => !/^\s*#/.test(line) && /\bgcloud /.test(line));
  assert.ok(commands.length >= 4);
  for (const line of commands) {
    assert.match(line, /gcloud (run services describe|secrets versions access|logging read)/, line);
  }
  assert.ok(!/\b(deploy|update|create|delete|add-iam-policy-binding|remove-iam-policy-binding|versions add|services enable|set-iam-policy|keys create)\b/.test(code), "変更のコマンドがない");
  assert.ok(!/set -x/.test(code));
  assert.ok(!/(echo|printf)[^\n]*\$PROXY_TEST_SECRET/.test(code), "シークレットを表示しない");
  assert.match(code, /unset PROXY_TEST_SECRET/);
  const bash = spawnSync("bash", ["-n", `${RELAY_DIR}/scripts/diagnose.sh`]);
  if (!bash.error) assert.equal(bash.status, 0, "diagnose.sh の構文");
});

done();
logs.restore();
