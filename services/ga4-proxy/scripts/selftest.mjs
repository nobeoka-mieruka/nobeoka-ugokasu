// GA4 中継の自己テスト（Google へは接続しない）。setup.sh がデプロイ前に自動で実行します。
//   node scripts/selftest.mjs
// 署名・時刻・再送・レート制限・対象外のメソッド・プロパティの固定・秘密情報を出さないことを、
// 偽物の Google を使って確かめます。使うシークレットはこの場で作る使い捨ての値です。
// 1つでも失敗したら終了コード1（setup.sh はデプロイせずに止まります）。

import { randomBytes } from "node:crypto";
import { DATA_API_BASE, canonicalString, createProxy, readProxyConfig, sha256Hex, signCanonical } from "../src/proxy.mjs";
import { createProxyServer } from "../src/server.mjs";

const SECRET = randomBytes(32).toString("base64url");
const TOKEN = "selftest-token-" + randomBytes(8).toString("hex");
const GOOGLE_ERROR = "selftest-google-error-" + randomBytes(8).toString("hex");
const PROPERTY = "546942310";
const NOW = Date.now();
const nowS = () => Math.floor(NOW / 1000);

let failed = 0;
const check = (label, condition) => {
  console.log(`${condition ? "OK" : "NG"}  ${label}`);
  if (!condition) failed++;
};

function fakeGoogle(dataStatus = 200) {
  const calls = [];
  const fetchFn = async (url, init = {}) => {
    calls.push({ url: String(url), headers: new Headers(init.headers) });
    if (String(url).includes("/token")) return Response.json({ access_token: TOKEN, expires_in: 3599 });
    if (dataStatus !== 200) return new Response(JSON.stringify({ error: { message: GOOGLE_ERROR } }), { status: dataStatus });
    return Response.json({ rows: [] });
  };
  return { calls, fetchFn };
}

function signed(path, body, { secret = SECRET, ts = nowS(), nonce = randomBytes(18).toString("base64url") } = {}) {
  const text = JSON.stringify(body);
  const signature = signCanonical(secret, canonicalString({ timestamp: String(ts), nonce, path, bodyHash: sha256Hex(text) }));
  return { method: "POST", path, body: text, headers: { "x-ga4-proxy-timestamp": String(ts), "x-ga4-proxy-nonce": nonce, "x-ga4-proxy-signature": signature } };
}

const setting = readProxyConfig({ GA4_PROPERTY_ID: PROPERTY, PROXY_HMAC_SECRET: SECRET, PROXY_RATE_PER_MINUTE: "5", PROXY_METADATA_TOKEN_URL: "http://metadata.test/token" });
check("設定の読み込み", setting.ok);
check("短いシークレットは起動しない", !readProxyConfig({ GA4_PROPERTY_ID: PROPERTY, PROXY_HMAC_SECRET: "short" }).ok);
check("G- の測定IDは受け付けない", !readProxyConfig({ GA4_PROPERTY_ID: "G-XXXX", PROXY_HMAC_SECRET: SECRET }).ok);

const google = fakeGoogle();
const logs = [];
const proxy = createProxy(setting.config, { fetch: google.fetchFn, now: () => NOW, log: (e) => logs.push(JSON.stringify(e)) });
const body = { dateRanges: [{ startDate: "7daysAgo", endDate: "yesterday" }], metrics: [{ name: "screenPageViews" }] };

const good = signed("/v1/runReport", body);
const okRes = await proxy.handle(good);
check("正しい署名は 200", okRes.status === 200);
const dataCall = google.calls.find((c) => c.url.startsWith(DATA_API_BASE));
check("プロパティIDは固定（546942310）", dataCall?.url === `${DATA_API_BASE}${PROPERTY}:runReport`);
check("トークンはメタデータサーバーから取得（鍵なし）", google.calls.some((c) => c.url.includes("/token") && c.headers.get("metadata-flavor") === "Google"));
check("同じ要求の再送は 401", (await proxy.handle(good)).status === 401);
check("署名なしは 401", (await proxy.handle({ ...good, headers: {} })).status === 401);
check("別のシークレットは 401", (await proxy.handle(signed("/v1/runReport", body, { secret: randomBytes(32).toString("base64url") }))).status === 401);
check("本文の改ざんは 401", (await proxy.handle({ ...signed("/v1/runReport", body), body: JSON.stringify({ ...body, limit: 1 }) })).status === 401);
check("121秒以上ずれた時刻は 401", (await proxy.handle(signed("/v1/runReport", body, { ts: nowS() - 121 }))).status === 401);
check("対象外のメソッドは 404", (await proxy.handle(signed("/v1/runRealtimeReport", body))).status === 404);
check("別のプロパティの指定は 400", (await proxy.handle(signed("/v1/runReport", { ...body, property: "properties/1" }))).status === 400);
const statuses = [];
for (let i = 0; i < 6; i++) statuses.push((await proxy.handle(signed("/v1/runReport", body))).status);
check("レート制限（1分5回の設定で、超えた分は 429）", statuses[0] === 200 && statuses.at(-1) === 429);
check("ログに秘密情報が出ない", !logs.join("\n").includes(SECRET) && !logs.join("\n").includes(TOKEN));

const failing = createProxy(setting.config, { fetch: fakeGoogle(403).fetchFn, now: () => NOW, log: (e) => logs.push(JSON.stringify(e)) });
const forbidden = await failing.handle(signed("/v1/runReport", body));
check("GA4 の 403 は種類だけを返す（Googleのエラー本文を出さない）", forbidden.status === 502 && !forbidden.body.includes(GOOGLE_ERROR) && !logs.join("\n").includes(GOOGLE_ERROR));

// 実際の HTTP サーバー（127.0.0.1 の空いているポート）
const server = createProxyServer(setting.config, { fetch: fakeGoogle().fetchFn, now: () => NOW, log: () => {} });
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const base = `http://127.0.0.1:${server.address().port}`;
try {
  check("HTTP: /healthz は 204", (await fetch(`${base}/healthz`)).status === 204);
  const unsigned = await fetch(`${base}/v1/runReport`, { method: "POST", body: "{}" });
  check("HTTP: 署名なしは 401", unsigned.status === 401);
  check("HTTP: CORSを許可しない", unsigned.headers.get("access-control-allow-origin") === null);
  check("HTTP: キャッシュさせない", unsigned.headers.get("cache-control") === "no-store");
  await unsigned.body?.cancel();
  const big = await fetch(`${base}/v1/runReport`, { method: "POST", body: "x".repeat(40 * 1024) });
  check("HTTP: 大きすぎる本文は 413", big.status === 413);
  await big.body?.cancel();
} finally {
  await new Promise((resolve) => server.close(resolve));
}

console.log(failed === 0 ? "\n自己テスト：すべて合格" : `\n自己テスト：${failed}件 失敗`);
process.exitCode = failed === 0 ? 0 : 1;
