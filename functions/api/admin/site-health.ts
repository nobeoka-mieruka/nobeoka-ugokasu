// POST /api/admin/site-health
// 定期チェック（.github/workflows/site-monitor.yml）の結果を保存します（server/siteHealth.ts）。
// 執行部ポータルの「サイトの状態」（/staff/status/）に表示されます。
//
// 認証：Authorizationヘッダーに "Bearer <NEWS_DETECT_SECRET>" を付けてPOSTしてください（URLに秘密キーを含めない）。
//       新しいページの公開検知（/api/admin/detect-new-pages）と同じ秘密キーです。
// 本文（JSON）：{ "checks": [{ "key": "deploy" | "site_update" | "rss", "status": "ok" | "warning" | "error", "summary": "説明" }] }

import type { PageDetectEnv } from "../../../server/env";
import { parseMonitorChecks, recordMonitorChecks } from "../../../server/siteHealth";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
  });

/** 文字列を比較する（一致するまでの時間から秘密キーを推測されないよう、長さ以外は全文字を比較する） */
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export const onRequest: PagesFunction<PageDetectEnv> = async (context) => {
  if (context.request.method !== "POST") {
    return new Response(JSON.stringify({ ok: false, error: "method_not_allowed" }), {
      status: 405,
      headers: { "Content-Type": "application/json; charset=utf-8", Allow: "POST" },
    });
  }
  const secret = context.env.NEWS_DETECT_SECRET;
  const header = context.request.headers.get("Authorization") ?? "";
  if (!secret || !safeEqual(header, `Bearer ${secret}`)) return json({ ok: false, error: "unauthorized" }, 401);

  const db = context.env.STAFF_DB;
  if (!db) return json({ ok: false, error: "no_database" }, 503);

  let body: unknown = null;
  try {
    body = await context.request.json();
  } catch {
    body = null;
  }
  const checks = parseMonitorChecks(body);
  if (!checks) return json({ ok: false, error: "invalid_body" }, 400);

  try {
    const result = await recordMonitorChecks(db, checks);
    // eslint-disable-next-line no-console
    console.log(JSON.stringify({ event: "site-health", states: Object.fromEntries(checks.map((c) => [c.key, c.status])), alerted: result.alerted }));
    return json({ ok: true, ...result });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("site-health: failed", err instanceof Error ? err.message : "unknown_error");
    return json({ ok: false, error: "record_failed" }, 500);
  }
};
