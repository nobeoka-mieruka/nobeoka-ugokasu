// POST /api/admin/detect-new-pages
// 新しく公開されたページを検知し、「最新のお知らせ」の下書き（非公開）を作ります（server/pageAnnouncements.ts）。
// GitHub Actions（.github/workflows/detect-new-pages.yml）が、mainへのpush後に呼び出します。
//
// 認証：Authorizationヘッダーに "Bearer <NEWS_DETECT_SECRET>" を付けてPOSTしてください（URLに秘密キーを含めない）。
// 本文（JSON・省略可）：
//   expectedCommit … 公開中のサイトがこのコミットでなければ何もせず 409 を返す（デプロイ完了前に検知しないため）
//   recordOnly     … true なら、増えたページを記録するだけで下書きを作らない（要確認ページの確認後に使う）

import type { PageDetectEnv } from "../../../server/env";
import { detectNewPages } from "../../../server/pageAnnouncements";
import { todayInJapan } from "../../../src/utils/dialogueEvents";

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

  let body: Record<string, unknown> = {};
  try {
    const parsed = await context.request.json();
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) body = parsed as Record<string, unknown>;
  } catch {
    body = {};
  }
  const expectedCommit = typeof body.expectedCommit === "string" && /^[0-9a-f]{7,40}$/.test(body.expectedCommit) ? body.expectedCommit : null;

  const origin = new URL(context.request.url).origin;
  try {
    const result = await detectNewPages(db, {
      fetchAsset: (path) => context.env.ASSETS.fetch(new URL(path, origin)),
      today: todayInJapan(),
      expectedCommit,
      recordOnly: body.recordOnly === true,
    });
    // eslint-disable-next-line no-console
    console.log(JSON.stringify({ event: "page-detect", status: result.status, drafted: result.drafted.length, needsReview: result.needsReview.length }));
    return json({ ok: true, ...result }, result.status === "not_live" ? 409 : 200);
  } catch (err) {
    // 読み込みに失敗した場合は何も作らない。詳細は返さない
    // eslint-disable-next-line no-console
    console.error("page-detect: failed", err instanceof Error ? err.message : "unknown_error");
    return json({ ok: false, error: "detect_failed" }, 500);
  }
};
