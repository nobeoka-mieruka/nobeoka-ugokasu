// POST /api/admin/sync-social-posts
// SNS（Facebook・Instagram・Threads）の投稿を取得し、画像を保存してキャッシュを更新する
// 保護されたエンドポイントです。次の2通りで呼び出されます。
//   1. 定期実行Worker（worker/social-cron）が3分ごとに呼び出す … SOCIAL_CRON_SECRET で認証
//   2. 管理者が動作確認のために手動で呼び出す                 … SOCIAL_SYNC_SECRET で認証
//
// 認証：Authorizationヘッダーに "Bearer <秘密キー>" を付けてPOSTしてください。
// 秘密キーをURLのクエリパラメータに含めることは絶対にしないでください（アクセスログに残るため）。

import type { SocialSyncEnv } from "../../../server/env";
import { runSocialSync, summarizeForLog } from "../../../server/socialSync";

/** 文字列を比較する（一致するまでの時間から秘密キーを推測されないよう、長さ以外は全文字を比較する） */
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function isAuthorized(request: Request, env: SocialSyncEnv): boolean {
  const header = request.headers.get("Authorization") ?? "";
  // 秘密キー自体が未設定の場合は、そのキーでは誰にも実行を許可しない
  return [env.SOCIAL_SYNC_SECRET, env.SOCIAL_CRON_SECRET].some((secret) => Boolean(secret) && safeEqual(header, `Bearer ${secret}`));
}

export const onRequest: PagesFunction<SocialSyncEnv> = async (context) => {
  if (context.request.method !== "POST") {
    return new Response(JSON.stringify({ ok: false, error: "method_not_allowed" }), {
      status: 405,
      headers: { "Content-Type": "application/json; charset=utf-8", Allow: "POST" },
    });
  }
  return onRequestPost(context);
};

export const onRequestPost: PagesFunction<SocialSyncEnv> = async (context) => {
  if (!isAuthorized(context.request, context.env)) {
    return new Response(JSON.stringify({ ok: false, error: "unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json; charset=utf-8" },
    });
  }

  try {
    const result = await runSocialSync(context.env);
    // eslint-disable-next-line no-console
    console.log(JSON.stringify(summarizeForLog(result)));

    // 返すのは件数・状態の要約だけ（トークンやエラーメッセージの詳細は返さない）
    return new Response(
      JSON.stringify({
        ok: result.ok,
        changed: result.changed,
        checkedAt: result.checkedAt,
        status: result.status,
        facebookFetched: result.facebookFetched,
        instagramFetched: result.instagramFetched,
        threadsFetched: result.threadsFetched,
        savedCount: result.savedCount,
        imagesDownloaded: result.imagesDownloaded,
        imagesFailed: result.imagesFailed,
        skippedReason: result.skippedReason ?? null,
      }),
      { status: 200, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" } },
    );
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("social-sync: unexpected error", err instanceof Error ? err.message : "unknown_error");
    // 予期しないエラーの詳細は返さない（内部情報の漏えい防止）
    return new Response(JSON.stringify({ ok: false, error: "sync_failed" }), {
      status: 500,
      headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
    });
  }
};
