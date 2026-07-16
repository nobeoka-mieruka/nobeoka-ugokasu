// POST /api/admin/sync-social-posts
// 管理者が動作確認のために手動でSNS同期を実行するための保護されたエンドポイントです。
// 30分ごとの自動同期（worker/social-sync.ts）とは別に、いつでも即座に同期を試せます。
//
// 認証：Authorizationヘッダーに "Bearer <SOCIAL_SYNC_SECRET>" を付けてPOSTしてください。
// 秘密キーをURLのクエリパラメータに含めることは絶対にしないでください（アクセスログに残るため）。

import type { SocialSyncEnv } from "../../../server/env";
import { runSocialSync, summarizeForLog } from "../../../server/socialSync";

function isAuthorized(request: Request, secret: string | undefined): boolean {
  if (!secret) return false; // 秘密キー自体が未設定の場合は、誰にも実行を許可しない
  const header = request.headers.get("Authorization") ?? "";
  const expected = `Bearer ${secret}`;
  return header === expected;
}

export const onRequestPost: PagesFunction<SocialSyncEnv> = async (context) => {
  if (!isAuthorized(context.request, context.env.SOCIAL_SYNC_SECRET)) {
    return new Response(JSON.stringify({ ok: false, error: "unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json; charset=utf-8" },
    });
  }

  try {
    const result = await runSocialSync(context.env);
    // eslint-disable-next-line no-console
    console.log(JSON.stringify(summarizeForLog(result)));

    return new Response(
      JSON.stringify({
        ok: result.ok,
        facebookFetched: result.facebookFetched,
        instagramFetched: result.instagramFetched,
        savedCount: result.savedCount,
        skippedReason: result.skippedReason ?? null,
      }),
      { status: 200, headers: { "Content-Type": "application/json; charset=utf-8" } },
    );
  } catch {
    // 予期しないエラーの詳細は返さない（内部情報の漏えい防止）
    return new Response(JSON.stringify({ ok: false, error: "sync_failed" }), {
      status: 500,
      headers: { "Content-Type": "application/json; charset=utf-8" },
    });
  }
};
