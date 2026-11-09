// アクセス解析（/staff/analytics/）のテストです。
//   server/ga4Analytics.ts・/staff/api/analytics・src/utils/analyticsCsv.ts・GA4のクリック計測のイベント名
// Google（トークン発行・GA4 Data API）への通信はすべて偽物の fetch で置き換えます。実際のGoogleへは一切アクセスしません。
// テスト中の数値はすべてテスト用の架空の値（FIXTURE）で、実際のアクセス数ではありません。
//
// 実行: npm run test:analytics

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { captureLogs, createCaller, loginAs, makeEnv, testRunner, type Router } from "./helpers/staffHarness";
import { resetSchemaCache } from "../../server/staffAuth";
import {
  GA4_SCOPE,
  GOOGLE_TOKEN_URL,
  REPORT_CACHE_TTL_SECONDS,
  TODAY_CACHE_TTL_SECONDS,
  addDays,
  changePercent,
  channelOf,
  deviceOf,
  getAnalyticsReport,
  normalizePagePath,
  pageGroupOf,
  parseAnalyticsRange,
  readGa4Config,
  resetGa4Caches,
  signServiceAccountJwt,
  transitionRate,
} from "../../server/ga4Analytics";
import * as analyticsApi from "../../functions/staff/api/analytics";
import { CSV_BOM, analyticsReportToCsv, csvCell, toCsv } from "../../src/utils/analyticsCsv";
import { renderDialogueFormApply, renderWelfareApply } from "../../src/utils/welfareDialogueView";
import { welfareDialogueState } from "../../src/data/welfareDialogue";
import { STAFF_SECTIONS } from "../../src/config/staffNav";
import { hasStaffPermission } from "../../server/staffPermissions";
import type { AnalyticsApiResponse, AnalyticsReport } from "../../src/types/analytics";

const logs = captureLogs();
const { test, done } = testRunner(() => {
  resetSchemaCache();
  resetGa4Caches();
  logs.lines.length = 0;
});

// ---- テスト用の鍵と設定（その場で生成。実在の鍵ではない） ----

const keyPair = (await crypto.subtle.generateKey(
  { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
  true,
  ["sign", "verify"],
)) as CryptoKeyPair;
const pkcs8 = new Uint8Array(await crypto.subtle.exportKey("pkcs8", keyPair.privateKey));
const PRIVATE_KEY_PEM = `-----BEGIN PRIVATE KEY-----\n${Buffer.from(pkcs8).toString("base64").replace(/(.{64})/g, "$1\n")}\n-----END PRIVATE KEY-----\n`;
const PRIVATE_KEY_BODY = Buffer.from(pkcs8).toString("base64").slice(20, 80);
const PROPERTY_ID = "123456789";
const SA_EMAIL = "analytics-reader@test-project.iam.gserviceaccount.com";
const ACCESS_TOKEN = "ya29.TEST_ACCESS_TOKEN_SHOULD_NEVER_APPEAR";
const GOOGLE_ERROR_BODY = "GOOGLE_ERROR_DETAIL_SHOULD_NEVER_APPEAR";

const gaEnv = (extra: Record<string, unknown> = {}) => ({
  GA4_PROPERTY_ID: PROPERTY_ID,
  GA4_SERVICE_ACCOUNT_EMAIL: SA_EMAIL,
  GA4_SERVICE_ACCOUNT_PRIVATE_KEY: PRIVATE_KEY_PEM,
  ...extra,
});

/** 2026-11-10 00:30（日本時間） */
const NOW = new Date("2026-11-09T15:30:00Z");

const decodePart = (part: string) => JSON.parse(Buffer.from(part, "base64url").toString("utf8"));

// ---- 偽物のGoogle（FIXTURE：テスト用の架空の値） ----

const row = (dims: string[], mets: number[]) => ({ dimensionValues: dims.map((value) => ({ value })), metricValues: mets.map((v) => ({ value: String(v) })) });
const FIXTURE_MAIN = {
  reports: [
    { rows: [row(["current"], [1200, 300, 450]), row(["previous"], [1000, 250, 0])] },
    { rows: [row(["20261103"], [100, 30, 40]), row(["20261105"], [200, 50, 60])] },
    {
      rows: [
        row(["/"], [400]),
        row(["/dialogue/"], [200]),
        row(["/dialogue"], [40]),
        row(["/voices/submit/"], [80]),
        row(["/voices/"], [60]),
        row(["/voice-post/"], [0]),
        row(["/supporters/join/"], [50]),
        row(["/activities/2026-10-01/"], [30]),
        row(["/profile/"], [20]),
        row(["/privacy/"], [10]),
      ],
    },
    { rows: [row(["Organic Search"], [200]), row(["Organic Social"], [100]), row(["Paid Social"], [10]), row(["Referral"], [40]), row(["Direct"], [90]), row(["Unassigned"], [10])] },
    { rows: [row(["mobile"], [300]), row(["desktop"], [120]), row(["tablet"], [20]), row(["smart tv"], [10])] },
  ],
};
const FIXTURE_EVENTS_BY_PAGE = {
  rows: [
    row(["welfare_apply_click", "/dialogue/"], [12]),
    row(["dialogue_apply_click", "/dialogue/"], [6]),
    row(["voices_form_click", "/voices/submit/"], [8]),
    row(["voice_form_click", "/voices/submit/"], [2]),
    row(["voices_form_click", "/contact/"], [3]),
    row(["supporter_join_click", "/supporters/join/"], [5]),
    row(["page_view", "/"], [999]),
  ],
};
const FIXTURE_EVENTS_BY_TYPE = {
  rows: [
    row(["welfare_apply_click", "top"], [9]),
    row(["welfare_apply_click", "bottom"], [3]),
    row(["dialogue_apply_click", "form_section"], [6]),
    row(["voices_form_click", "(not set)"], [3]),
  ],
};

interface Captured {
  url: string;
  method: string;
  headers: Headers;
  body: string;
}

function fakeGoogle(options: { tokenStatus?: number; dataStatus?: number; typeStatus?: number } = {}) {
  const calls: Captured[] = [];
  const fetchFn = async (input: string, init: RequestInit = {}) => {
    const captured = { url: String(input), method: init.method ?? "GET", headers: new Headers(init.headers), body: String(init.body ?? "") };
    calls.push(captured);
    const fail = (status: number) => new Response(JSON.stringify({ error: { message: GOOGLE_ERROR_BODY, status } }), { status });
    if (captured.url === GOOGLE_TOKEN_URL) {
      if (options.tokenStatus && options.tokenStatus !== 200) return fail(options.tokenStatus);
      return Response.json({ access_token: ACCESS_TOKEN, expires_in: 3599, token_type: "Bearer" });
    }
    if (options.dataStatus && options.dataStatus !== 200) return fail(options.dataStatus);
    if (captured.url.endsWith(":batchRunReports")) return Response.json(FIXTURE_MAIN);
    const body = JSON.parse(captured.body);
    const isType = body.dimensions.some((d: { name: string }) => d.name === "customEvent:content_type");
    if (isType) {
      if (options.typeStatus && options.typeStatus !== 200) return fail(options.typeStatus);
      return Response.json(FIXTURE_EVENTS_BY_TYPE);
    }
    return Response.json(FIXTURE_EVENTS_BY_PAGE);
  };
  return { calls, fetchFn };
}

class MemoryKV {
  store = new Map<string, string>();
  puts: { key: string; ttl?: number }[] = [];
  async get(key: string) {
    return this.store.get(key) ?? null;
  }
  async put(key: string, value: string, options?: { expirationTtl?: number }) {
    this.store.set(key, value);
    this.puts.push({ key, ttl: options?.expirationTtl });
  }
}

const range7 = () => parseAnalyticsRange(new URLSearchParams("range=7d"), NOW)!;

function assertNoSecrets(text: string, label: string) {
  for (const secret of [ACCESS_TOKEN, GOOGLE_ERROR_BODY, PRIVATE_KEY_BODY, "PRIVATE KEY"]) {
    assert.ok(!text.includes(secret), `${label} に秘密情報・Googleのエラー内容が含まれない: ${secret.slice(0, 12)}`);
  }
}

// ---- 設定 ----

await test("1. 設定：3つのうちどれかが無ければ未設定。G- で始まる測定IDはプロパティIDとして受け付けない", () => {
  assert.deepEqual(readGa4Config({}), { ok: false, issue: "missing" });
  assert.deepEqual(readGa4Config(gaEnv({ GA4_SERVICE_ACCOUNT_PRIVATE_KEY: "" })), { ok: false, issue: "missing" });
  assert.deepEqual(readGa4Config(gaEnv({ GA4_PROPERTY_ID: "G-GYSZ7DQ1D1" })), { ok: false, issue: "property_id_format" });
  assert.deepEqual(readGa4Config(gaEnv({ GA4_PROPERTY_ID: "12345 6789" })), { ok: false, issue: "property_id_format" });
  const escaped = readGa4Config(gaEnv({ GA4_SERVICE_ACCOUNT_PRIVATE_KEY: `"${PRIVATE_KEY_PEM.replace(/\n/g, "\\n")}"` }));
  assert.ok(escaped.ok && escaped.config.privateKeyPem === PRIVATE_KEY_PEM.trim(), "JSONキーの「\\n」表記も改行に戻す");
});

// ---- JWT ----

await test("2. JWT：RS256で署名し、発行者・読み取り専用スコープ・送信先・有効期限が正しく、公開鍵で検証できる", async () => {
  const config = readGa4Config(gaEnv());
  assert.ok(config.ok);
  const jwt = await signServiceAccountJwt(config.config, 1_800_000_000);
  const [header, claims, signature] = jwt.split(".");
  assert.deepEqual(decodePart(header), { alg: "RS256", typ: "JWT" });
  assert.deepEqual(decodePart(claims), {
    iss: SA_EMAIL,
    scope: "https://www.googleapis.com/auth/analytics.readonly",
    aud: "https://oauth2.googleapis.com/token",
    iat: 1_800_000_000,
    exp: 1_800_003_600,
  });
  const valid = await crypto.subtle.verify("RSASSA-PKCS1-v1_5", keyPair.publicKey, Buffer.from(signature, "base64url"), new TextEncoder().encode(`${header}.${claims}`));
  assert.equal(valid, true, "署名を公開鍵で検証できる");
  assert.ok(!/[+/=]/.test(jwt), "base64url（+ / = を含まない）");
});

// ---- 取得 ----

await test("3. 取得：トークンを読み取り専用スコープで取得し、プロパティIDのURLへ期間を指定して問い合わせる", async () => {
  const google = fakeGoogle();
  const range = range7();
  const result = await getAnalyticsReport(gaEnv(), range, { fetch: google.fetchFn, now: () => NOW.getTime() });
  assert.ok(result.ok && result.configured && "report" in result);
  assert.equal(result.cached, false);

  const [tokenCall, ...dataCalls] = google.calls;
  assert.equal(tokenCall.url, GOOGLE_TOKEN_URL);
  assert.equal(tokenCall.method, "POST");
  const form = new URLSearchParams(tokenCall.body);
  assert.equal(form.get("grant_type"), "urn:ietf:params:oauth:grant-type:jwt-bearer");
  assert.equal(decodePart(form.get("assertion")!.split(".")[1]).scope, GA4_SCOPE);

  assert.equal(dataCalls.length, 3);
  for (const call of dataCalls) {
    assert.ok(call.url.startsWith(`https://analyticsdata.googleapis.com/v1beta/properties/${PROPERTY_ID}:`), call.url);
    assert.equal(call.headers.get("Authorization"), `Bearer ${ACCESS_TOKEN}`);
    assert.equal(call.method, "POST");
  }
  const batch = JSON.parse(dataCalls.find((c) => c.url.endsWith(":batchRunReports"))!.body);
  assert.equal(batch.requests.length, 5);
  assert.deepEqual(batch.requests[0].dateRanges, [
    { startDate: "2026-11-03", endDate: "2026-11-09", name: "current" },
    { startDate: "2026-10-27", endDate: "2026-11-02", name: "previous" },
  ]);
  assert.deepEqual(batch.requests[0].metrics.map((m: { name: string }) => m.name), ["screenPageViews", "totalUsers", "sessions"]);
  assert.deepEqual(batch.requests.slice(1).map((r: { dimensions: { name: string }[] }) => r.dimensions[0].name), ["date", "pagePath", "sessionDefaultChannelGroup", "deviceCategory"]);
  const runs = dataCalls.filter((c) => c.url.endsWith(":runReport")).map((c) => JSON.parse(c.body));
  assert.deepEqual(runs.map((r) => r.dimensions.map((d: { name: string }) => d.name)), [["eventName", "pagePath"], ["eventName", "customEvent:content_type"]]);
  assert.ok(runs.every((r) => r.dimensionFilter.filter.fieldName === "eventName" && r.dimensionFilter.filter.inListFilter.values.includes("welfare_apply_click")));

  const report = result.report;
  assert.deepEqual(report.totals, { current: { pageViews: 1200, users: 300, sessions: 450 }, previous: { pageViews: 1000, users: 250, sessions: 0 } });
  assert.equal(report.daily.length, 7, "データの無い日も0で埋めて7日分");
  assert.deepEqual(report.daily.map((d) => d.pageViews), [100, 0, 200, 0, 0, 0, 0]);
  assert.equal(report.fetchedAt, NOW.toISOString());
  assert.equal(report.formResponses, "unlinked");
  assertNoSecrets(JSON.stringify(result), "応答");
  assertNoSecrets(logs.lines.join("\n"), "ログ");
});

await test("4. まとめ方：ページのまとまり・流入元・端末・ボタン（設置場所つき）・申込への遷移（参考）", async () => {
  const google = fakeGoogle();
  const result = await getAnalyticsReport(gaEnv(), range7(), { fetch: google.fetchFn, now: () => NOW.getTime() });
  assert.ok(result.ok && "report" in result);
  const r = result.report;
  const values = (rows: { label: string; value: number }[]) => Object.fromEntries(rows.map((x) => [x.label, x.value]));
  assert.deepEqual(values(r.pageGroups), {
    トップ: 400,
    福富千恵について: 20,
    活動報告: 30,
    意見交換会: 240,
    みんなの声: 140,
    みんなの声ポスト: 0,
    後援会入会案内: 50,
    その他: 10,
  });
  assert.deepEqual(values(r.channels), { 自然検索: 200, SNS: 110, 外部サイト: 40, 直接アクセス: 90, その他: 10 });
  assert.deepEqual(values(r.devices), { スマートフォン: 300, パソコン: 120, タブレット: 20, その他: 10 });
  assert.deepEqual(r.topPages[1], { path: "/dialogue/", group: "意見交換会", pageViews: 240 }, "/dialogue と /dialogue/ は同じページ");
  assert.equal(r.contentTypeAvailable, true);
  assert.deepEqual(
    r.events.map((e) => [e.name, e.contentType, e.count]),
    [
      ["welfare_apply_click", "top", 9],
      ["welfare_apply_click", "bottom", 3],
      ["dialogue_apply_click", "form_section", 6],
      ["voices_form_click", null, 3],
    ],
  );
  const t = Object.fromEntries(r.transitions.map((x) => [x.path, [x.pageViews, x.clicks, x.rate]]));
  assert.deepEqual(t["/dialogue/"], [240, 18, 7.5], "福祉＋地域の申込ボタン ÷ 表示回数");
  assert.deepEqual(t["/voices/submit/"], [80, 10, 12.5], "そのページで押された分だけ（お問い合わせページの分は含めない）。旧イベント名も合算");
  assert.deepEqual(t["/voice-post/"], [0, 0, null], "表示回数0は null（NaNにしない）");
  assert.deepEqual(t["/supporters/join/"], [50, 5, 10]);
});

await test("5. 設置場所（content_type）が未登録でGA4がエラーを返しても、イベント名だけの集計で表示を続ける", async () => {
  const google = fakeGoogle({ typeStatus: 400 });
  const result = await getAnalyticsReport(gaEnv(), range7(), { fetch: google.fetchFn, now: () => NOW.getTime() });
  assert.ok(result.ok && "report" in result);
  assert.equal(result.report.contentTypeAvailable, false);
  assert.deepEqual(
    result.report.events.map((e) => [e.name, e.contentType, e.count]),
    [
      ["welfare_apply_click", null, 12],
      ["dialogue_apply_click", null, 6],
      ["voices_form_click", null, 11],
      ["voice_form_click", null, 2],
      ["supporter_join_click", null, 5],
    ],
    "page_view など集計対象外のイベントは含めない",
  );
});

await test("6. 未設定のときは Google を呼ばず configured:false（数値なし）", async () => {
  const google = fakeGoogle();
  const result = await getAnalyticsReport({}, range7(), { fetch: google.fetchFn });
  assert.deepEqual(result, { ok: true, configured: false, issue: "missing" });
  assert.equal(google.calls.length, 0);
  const wrongId = await getAnalyticsReport(gaEnv({ GA4_PROPERTY_ID: "G-GYSZ7DQ1D1" }), range7(), { fetch: google.fetchFn });
  assert.deepEqual(wrongId, { ok: true, configured: false, issue: "property_id_format" });
});

await test("7. Googleが 403・500 を返したとき、認証に失敗したときは「unavailable」だけを返し、ログはエラーの種類だけ", async () => {
  for (const [options, kind] of [
    [{ dataStatus: 403 }, "api_forbidden"],
    [{ dataStatus: 500 }, "api_error"],
    [{ tokenStatus: 400 }, "auth_failed"],
  ] as const) {
    resetGa4Caches();
    logs.lines.length = 0;
    const google = fakeGoogle(options);
    const result = await getAnalyticsReport(gaEnv(), range7(), { fetch: google.fetchFn, now: () => NOW.getTime() });
    assert.deepEqual(result, { ok: false, configured: true, error: "unavailable" });
    assert.deepEqual(logs.lines.map((l) => JSON.parse(l)), [{ event: "ga4-analytics-error", kind }]);
    assertNoSecrets(logs.lines.join("\n"), "ログ");
  }
  // 通信できない
  resetGa4Caches();
  const offline = await getAnalyticsReport(gaEnv(), range7(), { fetch: async () => Promise.reject(new Error(GOOGLE_ERROR_BODY)), now: () => NOW.getTime() });
  assert.deepEqual(offline, { ok: false, configured: true, error: "unavailable" });
  assertNoSecrets(logs.lines.join("\n"), "ログ");
  // 壊れた鍵
  resetGa4Caches();
  const broken = await getAnalyticsReport(gaEnv({ GA4_SERVICE_ACCOUNT_PRIVATE_KEY: "-----BEGIN PRIVATE KEY-----\nAAAA\n-----END PRIVATE KEY-----" }), range7(), {
    fetch: fakeGoogle().fetchFn,
  });
  assert.deepEqual(broken, { ok: false, configured: true, error: "unavailable" });
  assert.equal(JSON.parse(logs.lines.at(-1)!).kind, "invalid_key");
});

await test("8. キャッシュ：2回目は Google を呼ばない（KVに1時間・今日は15分）。トークンは期限前まで使い回す。失敗は保存しない", async () => {
  const kv = new MemoryKV();
  const env = gaEnv({ SOCIAL_POSTS_KV: kv });
  const google = fakeGoogle();
  const deps = { fetch: google.fetchFn, now: () => NOW.getTime() };
  const first = await getAnalyticsReport(env, range7(), deps);
  const count = google.calls.length;
  const second = (await getAnalyticsReport(env, range7(), deps)) as Extract<AnalyticsApiResponse, { cached: boolean }>;
  assert.equal(google.calls.length, count, "2回目は呼ばない");
  assert.equal(second.cached, true);
  assert.deepEqual(second.report, (first as typeof second).report);
  assert.equal(kv.puts[0].ttl, REPORT_CACHE_TTL_SECONDS);
  assert.ok(kv.puts[0].key.includes(PROPERTY_ID) && kv.puts[0].key.includes("2026-11-03") && kv.puts[0].key.includes("2026-11-09"));
  assertNoSecrets([...kv.store.values()].join("\n"), "キャッシュ");

  await getAnalyticsReport(env, parseAnalyticsRange(new URLSearchParams("range=today"), NOW)!, deps);
  assert.equal(kv.puts[1].ttl, TODAY_CACHE_TTL_SECONDS);
  assert.equal(google.calls.filter((c) => c.url === GOOGLE_TOKEN_URL).length, 1, "別の期間でもトークンは使い回す");

  // トークンの期限が近づいたら取り直す
  const later = { fetch: google.fetchFn, now: () => NOW.getTime() + 3590 * 1000 };
  await getAnalyticsReport(env, parseAnalyticsRange(new URLSearchParams("range=30d"), NOW)!, later);
  assert.equal(google.calls.filter((c) => c.url === GOOGLE_TOKEN_URL).length, 2);

  // KVが無いときはメモリ上にキャッシュ
  resetGa4Caches();
  const memoryGoogle = fakeGoogle();
  await getAnalyticsReport(gaEnv(), range7(), { fetch: memoryGoogle.fetchFn, now: () => NOW.getTime() });
  const n = memoryGoogle.calls.length;
  await getAnalyticsReport(gaEnv(), range7(), { fetch: memoryGoogle.fetchFn, now: () => NOW.getTime() + 60_000 });
  assert.equal(memoryGoogle.calls.length, n);
  await getAnalyticsReport(gaEnv(), range7(), { fetch: memoryGoogle.fetchFn, now: () => NOW.getTime() + (REPORT_CACHE_TTL_SECONDS + 1) * 1000 });
  assert.ok(memoryGoogle.calls.length > n, "期限が過ぎたら取り直す");

  // 失敗はキャッシュしない
  resetGa4Caches();
  const failKv = new MemoryKV();
  await getAnalyticsReport(gaEnv({ SOCIAL_POSTS_KV: failKv }), range7(), { fetch: fakeGoogle({ dataStatus: 500 }).fetchFn, now: () => NOW.getTime() });
  assert.equal(failKv.puts.length, 0);
});

// ---- 期間 ----

await test("9. 期間：日本時間で計算し、過去N日は昨日まで。前期間は直前の同じ日数", () => {
  const p = (query: string, now = NOW) => parseAnalyticsRange(new URLSearchParams(query), now);
  assert.deepEqual(p("range=today"), { key: "today", start: "2026-11-10", end: "2026-11-10", days: 1, prevStart: "2026-11-09", prevEnd: "2026-11-09" }, "UTCでは11月9日でも日本時間は10日");
  assert.deepEqual(p("range=7d"), { key: "7d", start: "2026-11-03", end: "2026-11-09", days: 7, prevStart: "2026-10-27", prevEnd: "2026-11-02" });
  assert.deepEqual(p(""), p("range=7d"), "指定なしは過去7日");
  const r30 = p("range=30d")!;
  assert.deepEqual([r30.start, r30.end, r30.days, r30.prevStart, r30.prevEnd], ["2026-10-11", "2026-11-09", 30, "2026-09-11", "2026-10-10"]);
  const r90 = p("range=90d")!;
  assert.deepEqual([r90.start, r90.days, r90.prevEnd], ["2026-08-12", 90, "2026-08-11"]);
  assert.deepEqual(p("range=custom&start=2026-02-27&end=2026-03-02"), {
    key: "custom",
    start: "2026-02-27",
    end: "2026-03-02",
    days: 4,
    prevStart: "2026-02-23",
    prevEnd: "2026-02-26",
  });
  assert.equal(p("range=custom&start=2026-11-10&end=2026-11-10")!.days, 1, "今日まで指定できる");
  for (const bad of [
    "range=365d",
    "range=custom",
    "range=custom&start=2026-11-05&end=2026-11-01",
    "range=custom&start=2026-11-01&end=2026-11-11",
    "range=custom&start=2026-02-30&end=2026-03-02",
    "range=custom&start=2026/11/01&end=2026-11-02",
    "range=custom&start=2025-10-05&end=2026-11-09",
    "range=custom&start=2015-01-01&end=2015-02-01",
  ]) {
    assert.equal(p(bad), null, bad);
  }
  assert.ok(p("range=custom&start=2025-10-06&end=2026-11-09"), "400日までは指定できる");
  assert.equal(addDays("2028-02-28", 1), "2028-02-29");
});

await test("10. 分類：ページのまとまり・流入元・端末の対応表", () => {
  assert.equal(normalizePagePath("/dialogue"), "/dialogue/");
  assert.equal(normalizePagePath("/voices/submit?utm=x"), "/voices/submit/");
  assert.equal(normalizePagePath("/rss.xml"), "/rss.xml");
  const g = (path: string) => pageGroupOf(path).label;
  assert.equal(g("/"), "トップ");
  assert.equal(g("/profile/"), "福富千恵について");
  assert.equal(g("/activities/"), "活動報告");
  assert.equal(g("/activities/sns/123/"), "活動報告");
  assert.equal(g("/dialogue/"), "意見交換会");
  assert.equal(g("/voices/"), "みんなの声");
  assert.equal(g("/voices/submit/"), "みんなの声");
  assert.equal(g("/voice-post/"), "みんなの声ポスト");
  assert.equal(g("/supporters/join/"), "後援会入会案内");
  assert.equal(g("/supporters/"), "その他");
  assert.equal(g("/profile-old/"), "その他");
  assert.equal(channelOf("Organic Search").label, "自然検索");
  assert.equal(channelOf("Organic Social").label, "SNS");
  assert.equal(channelOf("Paid Social").label, "SNS");
  assert.equal(channelOf("Referral").label, "外部サイト");
  assert.equal(channelOf("Direct").label, "直接アクセス");
  assert.equal(channelOf("Email").label, "その他");
  assert.equal(deviceOf("mobile").label, "スマートフォン");
  assert.equal(deviceOf("desktop").label, "パソコン");
  assert.equal(deviceOf("tablet").label, "タブレット");
  assert.equal(deviceOf("smart tv").label, "その他");
});

await test("11. 遷移率（参考）と前期間比：0で割らない（null）", () => {
  assert.equal(transitionRate(3, 40), 7.5);
  assert.equal(transitionRate(1, 3), 33.3);
  assert.equal(transitionRate(5, 0), null);
  assert.equal(transitionRate(0, 0), null);
  assert.equal(transitionRate(0, 10), 0);
  assert.equal(changePercent(1200, 1000), 20);
  assert.equal(changePercent(900, 1000), -10);
  assert.equal(changePercent(10, 0), null);
});

await test("12. CSV：カンマ・引用符・改行を正しく囲み、数式になりうる値を無害化する。BOM付き", () => {
  assert.equal(csvCell("abc"), "abc");
  assert.equal(csvCell("a,b"), '"a,b"');
  assert.equal(csvCell('say "hi"'), '"say ""hi"""');
  assert.equal(csvCell("line1\nline2"), '"line1\nline2"');
  assert.equal(csvCell("=HYPERLINK(1)"), "'=HYPERLINK(1)");
  assert.equal(csvCell("@cmd"), "'@cmd");
  assert.equal(csvCell("-1+2"), "'-1+2");
  assert.equal(csvCell(-12.5), "-12.5", "数値はそのまま");
  assert.equal(csvCell(null), "");
  assert.equal(toCsv([["a", 1], ["b,c", null]]), 'a,1\r\n"b,c",\r\n');
  assert.equal(CSV_BOM, "﻿");
});

await test("13. CSV：画面と同じ内容（遷移率は参考指標、フォーム回答数は未連携）", async () => {
  const result = await getAnalyticsReport(gaEnv(), range7(), { fetch: fakeGoogle().fetchFn, now: () => NOW.getTime() });
  const csv = analyticsReportToCsv((result as { report: AnalyticsReport }).report);
  assert.ok(csv.startsWith("アクセス解析,2026-11-03〜2026-11-09\r\n"));
  assert.ok(csv.includes("表示回数,1200,1000"));
  assert.ok(csv.includes("2026-11-04,0,0,0"));
  assert.ok(csv.includes("意見交換会,/dialogue/,240,18,7.5,未連携"));
  assert.ok(csv.includes("みんなの声ポスト,/voice-post/,0,0,—,未連携"));
  assert.ok(csv.includes("申込完了率ではありません"));
  assert.ok(!csv.includes("申込完了率,"), "申込完了率という列は作らない");
});

// ---- /staff/api/analytics ----

const router: Router = (method, pathname) =>
  pathname === "/staff/api/analytics" && method === "GET" ? { handler: analyticsApi.onRequestGet as never, params: {} } : { handler: null, params: {} };
const { call } = createCaller(router);

await test("14. /staff/api/analytics：ログインしていないと401で、処理まで届かない（Googleも呼ばない）", async () => {
  const realFetch = globalThis.fetch;
  let fetched = 0;
  globalThis.fetch = (async () => {
    fetched++;
    return new Response("{}");
  }) as typeof fetch;
  try {
    const env = makeEnv(gaEnv());
    const res = await call(env, "/staff/api/analytics?range=7d");
    assert.equal(res.res.status, 401);
    assert.equal(res.reachedHandler, false);
    assert.equal(fetched, 0);
    const forged = await call(env, "/staff/api/analytics?range=7d", { cookie: "staff_session=forged-session-id" });
    assert.notEqual(forged.res.status, 200);
    assert.equal(forged.reachedHandler, false);
  } finally {
    globalThis.fetch = realFetch;
  }
});

await test("15. /staff/api/analytics：ログイン中は200（未設定なら設定手順用の応答、設定済みならデータ）。期間が不正なら400", async () => {
  const unconfigured = makeEnv();
  const auth = await loginAs(unconfigured);
  const res = await call(unconfigured, "/staff/api/analytics?range=30d", { cookie: auth.cookie });
  assert.equal(res.res.status, 200);
  assert.deepEqual(res.json, { ok: true, configured: false, issue: "missing" });
  assert.match(res.res.headers.get("Cache-Control") ?? "", /no-store/);

  const bad = await call(unconfigured, "/staff/api/analytics?range=custom&start=2026-11-05&end=2026-11-01", { cookie: auth.cookie });
  assert.equal(bad.res.status, 400);
  assert.deepEqual(bad.json, { ok: false, error: "invalid_range" });

  const realFetch = globalThis.fetch;
  const google = fakeGoogle();
  globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => google.fetchFn(String(input), init)) as typeof fetch;
  try {
    const env = makeEnv(gaEnv());
    const login = await loginAs(env);
    const ok = await call(env, "/staff/api/analytics?range=7d", { cookie: login.cookie });
    assert.equal(ok.res.status, 200);
    assert.equal((ok.json as { configured: boolean }).configured, true);
    assert.ok(google.calls.some((c) => c.url.includes(`/properties/${PROPERTY_ID}:`)));
    assertNoSecrets(ok.text, "API応答");

    resetGa4Caches();
    const failing = fakeGoogle({ dataStatus: 403 });
    globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => failing.fetchFn(String(input), init)) as typeof fetch;
    const ng = await call(env, "/staff/api/analytics?range=90d", { cookie: login.cookie });
    assert.equal(ng.res.status, 502);
    assert.deepEqual(ng.json, { ok: false, configured: true, error: "unavailable" });
    assertNoSecrets(ng.text + logs.lines.join("\n"), "API応答・ログ");
  } finally {
    globalThis.fetch = realFetch;
  }
});

await test("16. 権限とナビ：管理者に analytics:read があり、ポータルに「アクセス解析」を出す", () => {
  assert.equal(hasStaffPermission({ email: "staff@example.com" } as never, "analytics:read"), true);
  assert.equal(hasStaffPermission(null, "analytics:read"), false);
  const section = STAFF_SECTIONS.find((s) => s.key === "analytics");
  assert.equal(section?.label, "アクセス解析");
  assert.equal(section?.href, "/staff/analytics/");
  const page = readFileSync("src/pages/staff/analytics/index.astro", "utf8");
  assert.ok(page.includes("申込完了率）ではありません") && page.includes("未連携"));
  const script = readFileSync("src/scripts/staff/analytics.ts", "utf8");
  assert.ok(!/innerHTML|insertAdjacentHTML|outerHTML/.test(script), "画面の表示は textContent だけ");
});

// ---- GA4のクリック計測（イベント名） ----

await test("17. イベント名：福祉の申込は welfare_apply_click、申込フォーム欄は dialogue_apply_click（form_section）", () => {
  const state = welfareDialogueState("2026-11-01");
  for (const position of ["top", "bottom"] as const) {
    const html = renderWelfareApply(state, position);
    assert.equal(html.match(/data-track="/g)?.length, 1, "1つのボタンに1つのイベント");
    assert.ok(html.includes('data-track="welfare_apply_click"') && html.includes(`data-track-type="${position}"`));
  }
  const form = renderDialogueFormApply(true);
  assert.equal(form.match(/data-track="/g)?.length, 1);
  assert.ok(form.includes('data-track="dialogue_apply_click"') && form.includes('data-track-type="form_section"'));
});

await test("18. イベント名：/voices/submit/ は voices_form_click、後援会の入会申込は supporter_join_click（設置場所つき）", () => {
  const submit = readFileSync("src/pages/voices/submit.astro", "utf8");
  assert.equal(submit.match(/data-track="voices_form_click"/g)?.length, 2);
  assert.ok(submit.includes('data-track-type="general"') && submit.includes('data-track-type="general_bottom"'));
  assert.ok(!submit.includes('"voice_form_click"'));
  const join = readFileSync("src/pages/supporters/join.astro", "utf8");
  assert.equal(join.match(/data-track="supporter_join_click"/g)?.length, 3);
  for (const type of ["intro", "form_area", "fallback_link"]) assert.ok(join.includes(`data-track-type="${type}"`), type);
  assert.equal(join.match(/href=\{supportersConfig\.membershipFormUrl\}/g)?.length, 3, "data-track を付けていない入会フォームへのリンクが無い");
  const post = readFileSync("src/pages/voice-post.astro", "utf8");
  assert.equal(post.match(/data-track="voice_post_click"/g)?.length, 2);
});

// 計測の共通処理（analyticsBootstrap）を、最小限の偽物のブラウザで動かして「1クリック＝1イベント」を確認する
class FakeElement {
  parent: FakeElement | null = null;
  dataset: Record<string, string> = {};
  constructor(readonly tag: string, readonly attrs: Record<string, string> = {}, readonly text = "") {
    for (const [key, value] of Object.entries(attrs)) {
      if (key.startsWith("data-")) this.dataset[key.slice(5).replace(/-([a-z])/g, (_, c: string) => c.toUpperCase())] = value;
    }
  }
  get href() {
    return this.attrs.href;
  }
  get textContent() {
    return this.text;
  }
  append(child: FakeElement) {
    child.parent = this;
    return child;
  }
  matches(selector: string) {
    if (selector === "a[href]") return this.tag === "a" && "href" in this.attrs;
    if (selector === "[data-track]") return "data-track" in this.attrs;
    return false;
  }
  closest(selector: string): FakeElement | null {
    for (let node: FakeElement | null = this; node; node = node.parent) if (node.matches(selector)) return node;
    return null;
  }
}
class FakeAnchor extends FakeElement {}

await test("19. 1クリック＝1イベント：data-track があれば自動計測より優先して1回だけ送る。入れ子でも二重にならない", async () => {
  const { SITE_URL } = await import("../../src/config/siteUrl");
  const { supportersConfig } = await import("../../src/config/supporters");
  const { voicesConfig } = await import("../../src/config/voicesConfig");
  let clickHandler: ((event: { target: unknown }) => void) | null = null;
  const g = globalThis as Record<string, unknown>;
  const win: Record<string, unknown> = { location: { hostname: new URL(SITE_URL).hostname }, localStorage: { getItem: () => null, setItem() {} } };
  g.window = win;
  g.Element = FakeElement;
  g.HTMLAnchorElement = FakeAnchor;
  g.document = {
    addEventListener: (type: string, handler: typeof clickHandler) => {
      if (type === "click") clickHandler = handler;
    },
    createElement: () => ({}),
    head: { appendChild() {} },
  };
  await import("../../src/scripts/analyticsBootstrap");
  assert.ok(clickHandler, "クリックの計測を登録している");
  const dataLayer = win.dataLayer as IArguments[];
  const events = () => dataLayer.map((args) => [...args]).filter((args) => args[0] === "event").map((args) => [args[1], (args[2] as Record<string, string>)?.content_type ?? null]);
  const click = (target: FakeElement) => {
    dataLayer.length = 0;
    clickHandler!({ target });
    return events();
  };

  // 後援会の入会フォーム（自動計測の対象URL）に data-track を付けたボタン → data-track の1件だけ
  const join = new FakeAnchor("a", { href: supportersConfig.membershipFormUrl, "data-track": "supporter_join_click", "data-track-type": "intro" });
  const icon = join.append(new FakeElement("svg"));
  assert.deepEqual(click(icon), [["supporter_join_click", "intro"]]);

  // 入れ子：data-track の中に data-track があっても、近い方の1件だけ
  const outer = new FakeElement("div", { "data-track": "news_detail_click", "data-track-type": "internal" });
  const inner = outer.append(new FakeAnchor("a", { href: voicesConfig.googleFormUrl, "data-track": "voices_form_click", "data-track-type": "general" }));
  assert.deepEqual(click(inner), [["voices_form_click", "general"]]);

  // data-track の無いリンクは、自動計測で1件（一般用フォームは voices_form_click に統一）
  assert.deepEqual(click(new FakeAnchor("a", { href: voicesConfig.googleFormUrl })), [["voices_form_click", null]]);
  assert.deepEqual(click(new FakeAnchor("a", { href: supportersConfig.membershipFormUrl })), [["supporter_join_click", null]]);
  // リンク以外は送らない
  assert.deepEqual(click(new FakeElement("div", { "data-track": "x" })), []);
});

done();
