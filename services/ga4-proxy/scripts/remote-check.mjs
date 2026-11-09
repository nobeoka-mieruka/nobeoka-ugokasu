// デプロイした GA4 中継の確認（setup.sh が自動で実行します）。
//   PROXY_TEST_SECRET=<値> node scripts/remote-check.mjs <中継のURL>
// シークレットは環境変数で受け取り、画面・ログには出しません。
//
// 1) 安全性：/health-check、署名なし・別のシークレット・古い時刻・再送が拒否されること、対象外のメソッドが 404 になること
// 2) GA4 への実接続：執行部ポータルと同じ期間（日本時間で昨日まで）の過去7日・30日・90日の合計、
//    過去7日の上位ページ、申込ボタンのクリック数、設置場所（content_type）の登録状況
//    → 表示される数値は GA4 の実データです。ポータルや GA4 の画面と照合するために表示します。
// 終了コード：0 すべて成功／2 安全性の確認に失敗（公開を止めるべき）／3 GA4 への接続に失敗／1 その他

import { randomBytes } from "node:crypto";
import { HEALTH_CHECK_PATH, canonicalString, sha256Hex, signCanonical } from "../src/proxy.mjs";

const base = (process.argv[2] ?? "").replace(/\/+$/, "");
const secret = process.env.PROXY_TEST_SECRET ?? "";

function sign(path, text, { key = secret, ts = Math.floor(Date.now() / 1000), nonce = randomBytes(18).toString("base64url") } = {}) {
  return {
    "Content-Type": "application/json",
    "X-Ga4-Proxy-Timestamp": String(ts),
    "X-Ga4-Proxy-Nonce": nonce,
    "X-Ga4-Proxy-Signature": signCanonical(key, canonicalString({ timestamp: String(ts), nonce, path, bodyHash: sha256Hex(text) })),
  };
}

async function post(path, body, headers) {
  const res = await fetch(base + path, { method: "POST", headers, body, signal: AbortSignal.timeout(20_000) });
  const text = await res.text();
  return { status: res.status, text };
}

/** 日本時間の YYYY-MM-DD（days 日前） */
function jstDate(daysAgo) {
  const d = new Date(Date.now() + 9 * 3600_000 - daysAgo * 86_400_000);
  return d.toISOString().slice(0, 10);
}

const APPLY_EVENTS = ["welfare_apply_click", "dialogue_apply_click", "voices_form_click", "voice_form_click", "voice_post_click", "supporter_join_click"];
const fmt = (n) => Number(n || 0).toLocaleString("ja-JP");

async function main() {
  let securityFailed = 0;
  const check = (label, ok, detail = "") => {
    console.log(`${ok ? "OK" : "NG"}  ${label}${detail ? `（${detail}）` : ""}`);
    if (!ok) securityFailed++;
  };

  console.log("---- 安全性の確認 ----");
  try {
    const health = await fetch(`${base}${HEALTH_CHECK_PATH}`, { signal: AbortSignal.timeout(30_000) });
    check(HEALTH_CHECK_PATH, health.status === 204, `HTTP ${health.status}`);
  } catch {
    console.log(`NG  ${HEALTH_CHECK_PATH} に接続できません`);
    return 2;
  }
  const probe = JSON.stringify({ dateRanges: [{ startDate: jstDate(1), endDate: jstDate(1) }], metrics: [{ name: "screenPageViews" }], limit: 1 });
  const unsigned = await post("/v1/runReport", probe, { "Content-Type": "application/json" });
  check("署名なしは拒否", unsigned.status === 401, `HTTP ${unsigned.status}`);
  const wrong = await post("/v1/runReport", probe, sign("/v1/runReport", probe, { key: randomBytes(32).toString("base64url") }));
  check("別のシークレットは拒否", wrong.status === 401, `HTTP ${wrong.status}`);
  const stale = await post("/v1/runReport", probe, sign("/v1/runReport", probe, { ts: Math.floor(Date.now() / 1000) - 600 }));
  check("10分前の署名は拒否", stale.status === 401, `HTTP ${stale.status}`);
  const other = await post("/v1/runRealtimeReport", probe, sign("/v1/runRealtimeReport", probe));
  check("対象外のメソッドは 404", other.status === 404, `HTTP ${other.status}`);
  const okHeaders = sign("/v1/runReport", probe);
  const first = await post("/v1/runReport", probe, okHeaders);
  check("正しい署名は受け付ける", first.status !== 401 && first.status !== 404, `HTTP ${first.status}`);
  const replay = await post("/v1/runReport", probe, okHeaders);
  check("同じ要求の再送は拒否", replay.status === 401, `HTTP ${replay.status}`);
  if (securityFailed > 0) return 2;

  console.log("\n---- GA4 への実接続（プロパティ 546942310。数値は GA4 の実データ） ----");
  const yesterday = jstDate(1);
  const ranges = [7, 30, 90].map((days) => ({ days, startDate: jstDate(days), endDate: yesterday }));
  const totals = (r) => ({ dateRanges: [{ startDate: r.startDate, endDate: r.endDate }], metrics: [{ name: "screenPageViews" }, { name: "totalUsers" }, { name: "sessions" }] });
  const batch = JSON.stringify({
    requests: [
      ...ranges.map(totals),
      {
        dateRanges: [{ startDate: ranges[0].startDate, endDate: yesterday }],
        dimensions: [{ name: "pagePath" }],
        metrics: [{ name: "screenPageViews" }],
        orderBys: [{ metric: { metricName: "screenPageViews" }, desc: true }],
        limit: 10,
      },
      {
        dateRanges: [{ startDate: ranges[0].startDate, endDate: yesterday }],
        dimensions: [{ name: "eventName" }],
        metrics: [{ name: "eventCount" }],
        dimensionFilter: { filter: { fieldName: "eventName", inListFilter: { values: APPLY_EVENTS } } },
        limit: 50,
      },
    ],
  });
  const result = await post("/v1/batchRunReports", batch, sign("/v1/batchRunReports", batch));
  if (result.status !== 200) {
    let kind = "";
    try {
      kind = JSON.parse(result.text).error ?? "";
    } catch {}
    console.log(`NG  GA4 からデータを取得できません（HTTP ${result.status}${kind ? ` / ${kind}` : ""}）`);
    if (kind === "upstream_forbidden") console.log("    → GA4 の「プロパティのアクセス管理」で、サービスアカウントが「閲覧者」になっているか確認してください。");
    if (kind === "token_unavailable") console.log("    → Cloud Run に GA4 用サービスアカウントが割り当てられているか確認してください。");
    return 3;
  }
  const reports = JSON.parse(result.text).reports ?? [];
  const metric = (report, i) => Number(report?.rows?.[0]?.metricValues?.[i]?.value ?? 0);
  console.log("OK  GA4 Data API に接続できました");
  console.log("\n期間（日本時間・昨日まで）       表示回数    ユーザー数    訪問数");
  ranges.forEach((r, i) => {
    console.log(`過去${String(r.days).padStart(2)}日 ${r.startDate}〜${r.endDate}  ${fmt(metric(reports[i], 0)).padStart(8)}  ${fmt(metric(reports[i], 1)).padStart(10)}  ${fmt(metric(reports[i], 2)).padStart(8)}`);
  });
  console.log("\n過去7日の上位ページ（表示回数）");
  const pages = reports[3]?.rows ?? [];
  if (pages.length === 0) console.log("  （データなし）");
  for (const row of pages) console.log(`  ${fmt(row.metricValues?.[0]?.value).padStart(7)}  ${row.dimensionValues?.[0]?.value ?? ""}`);
  console.log("\n過去7日の申込ボタンのクリック数（申込の完了数ではありません）");
  const events = new Map((reports[4]?.rows ?? []).map((row) => [row.dimensionValues?.[0]?.value, Number(row.metricValues?.[0]?.value ?? 0)]));
  for (const name of APPLY_EVENTS) console.log(`  ${fmt(events.get(name) ?? 0).padStart(7)}  ${name}`);

  const typeBody = JSON.stringify({
    dateRanges: [{ startDate: ranges[0].startDate, endDate: yesterday }],
    dimensions: [{ name: "customEvent:content_type" }],
    metrics: [{ name: "eventCount" }],
    limit: 1,
  });
  const type = await post("/v1/runReport", typeBody, sign("/v1/runReport", typeBody));
  console.log(
    type.status === 200
      ? "\nOK  設置場所（content_type）のカスタムディメンションは登録済み"
      : "\n未設定  設置場所（content_type）のカスタムディメンションが未登録です（GA4の「カスタム定義」で登録すると、設置場所の内訳が表示されます）",
  );
  return 0;
}

// 入口（定数・関数の定義の後で実行する）
if (!/^https:\/\/|^http:\/\/127\.0\.0\.1:/.test(base) || secret.length < 32) {
  console.log("使い方: PROXY_TEST_SECRET=<値> node scripts/remote-check.mjs https://<中継のURL>");
  process.exitCode = 1;
} else {
  process.exitCode = await main();
}
