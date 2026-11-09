// 診断用（読み取りのみ）：執行部ポータルと「同じ本文・同じ署名方式・同時に3つ」の要求を中継へ送り、結果を表示します。
//   PROXY_TEST_SECRET=<値> node scripts/portal-check.mjs <中継のURL> [7d|30d|90d|today]
// ・シークレットは環境変数で受け取り、画面・ログには出しません。
// ・表示するのは HTTP の状態・中継のエラーの種類・所要時間・行数だけです（GA4 の数値そのものは表示しません）。
// ・GA4 からは読み取るだけで、設定は何も変更しません。
// 終了コード：0 ポータルに必要な2つの要求が成功／4 どちらかが失敗／1 使い方の誤り

import { randomBytes } from "node:crypto";
import { canonicalString, sha256Hex, signCanonical } from "../src/proxy.mjs";
import { portalRange, portalRequests } from "./portal-requests.mjs";

const base = (process.argv[2] ?? "").replace(/\/+$/, "");
const rangeKey = process.argv[3] ?? "7d";
const secret = process.env.PROXY_TEST_SECRET ?? "";

/** 中継の応答から、表示してよい情報（エラーの種類・GA4 の状態コード）だけを取り出す */
function safeErrorInfo(text) {
  try {
    const body = JSON.parse(text);
    const parts = [];
    if (typeof body.error === "string" && /^[a-z_]{1,40}$/.test(body.error)) parts.push(body.error);
    if (Number.isInteger(body.upstreamStatus)) parts.push(`GA4 ${body.upstreamStatus}`);
    return parts.join(" / ");
  } catch {
    return "JSON ではない応答（Cloud Run 本体のエラーページの可能性）";
  }
}

async function send(item, timestamp) {
  const path = `/v1/${item.method}`;
  const text = JSON.stringify(item.body);
  const nonce = randomBytes(18).toString("base64url");
  const headers = {
    "Content-Type": "application/json",
    "X-Ga4-Proxy-Timestamp": String(timestamp),
    "X-Ga4-Proxy-Nonce": nonce,
    "X-Ga4-Proxy-Signature": signCanonical(secret, canonicalString({ timestamp: String(timestamp), nonce, path, bodyHash: sha256Hex(text) })),
  };
  const started = Date.now();
  try {
    // ポータル（Cloudflare）と同じ15秒で打ち切る
    const res = await fetch(base + path, { method: "POST", headers, body: text, signal: AbortSignal.timeout(15_000) });
    const body = await res.text();
    return { item, status: res.status, ms: Date.now() - started, body, bytes: text.length };
  } catch (err) {
    return { item, status: 0, ms: Date.now() - started, body: "", bytes: text.length, failure: err?.name === "TimeoutError" ? "15秒で応答なし" : "接続できません" };
  }
}

function rowCounts(result) {
  try {
    const data = JSON.parse(result.body);
    const reports = Array.isArray(data.reports) ? data.reports : [data];
    return reports.map((r) => (Array.isArray(r.rows) ? r.rows.length : 0)).join("・");
  } catch {
    return "?";
  }
}

async function main() {
  const range = portalRange(rangeKey);
  console.log(`期間 ${rangeKey}：${range.start}〜${range.end}（比較 ${range.prevStart}〜${range.prevEnd}）`);
  console.log("ポータルと同じ3つの要求を同時に送ります…\n");
  // ポータルと同じく、3つとも同じ時刻で署名して同時に送る
  const timestamp = Math.floor(Date.now() / 1000);
  const results = await Promise.all(portalRequests(range).map((item) => send(item, timestamp)));
  let failed = 0;
  for (const r of results) {
    const ok = r.status === 200;
    if (!ok && !r.item.optional) failed++;
    const mark = ok ? "OK  " : r.item.optional ? "参考" : "NG  ";
    const detail = ok ? `行数 ${rowCounts(r)}` : r.failure ?? safeErrorInfo(r.body);
    console.log(`${mark} HTTP ${r.status || "-"}  ${String(r.ms).padStart(5)}ms  本文 ${r.bytes}B  ${r.item.label}`);
    console.log(`      ${detail}`);
  }
  console.log(
    failed === 0
      ? "\n結果：ポータルに必要な要求はすべて成功しました（ポータルが失敗する場合は Cloudflare 側の設定を確認してください）"
      : "\n結果：失敗した要求があります。上の HTTP の状態とエラーの種類、Cloud Run のログ（diagnose.sh が表示）を確認してください",
  );
  return failed === 0 ? 0 : 4;
}

if (!/^https:\/\/|^http:\/\/127\.0\.0\.1:/.test(base) || secret.length < 32 || !portalRange(rangeKey)) {
  console.log("使い方: PROXY_TEST_SECRET=<値> node scripts/portal-check.mjs https://<中継のURL> [7d|30d|90d|today]");
  process.exitCode = 1;
} else {
  process.exitCode = await main();
}
