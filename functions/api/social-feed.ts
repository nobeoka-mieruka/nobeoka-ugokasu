// GET /api/social-feed
// ホームページの「活動報告」ページから読み込む公開APIです。
// 定期同期（worker/social-cron）がKVへ保存した結果を返すだけで、このAPI自体はSNSへ
// 問い合わせません（server/socialFeed.ts参照）。アクセストークン・Meta APIの生レスポンス・
// 内部エラー詳細など、表示に不要な情報は一切含めません（返すのは正規化済みの投稿一覧と
// プラットフォームごとの状態のみ）。

import type { SocialFeedStatus, SocialPostsResponse } from "../../src/types/social";
import type { SocialSyncEnv } from "../../server/env";
import { getSocialFeed } from "../../server/socialFeed";

const DEFAULT_STATUS: SocialFeedStatus = { facebook: "not_configured", instagram: "not_configured", threads: "not_configured" };

async function handleGet(context: Parameters<PagesFunction<SocialSyncEnv>>[0]): Promise<Response> {
  let body: SocialPostsResponse;

  try {
    body = await getSocialFeed(context.env);
  } catch (err) {
    // KVバインディング未設定など、想定外の問題が起きても、ページ全体を壊さないよう空の結果を返す。
    // 原因調査のため、エラーメッセージのみ（秘密情報は含まない）Cloudflare Functionsログへ残す。
    // eslint-disable-next-line no-console
    console.error("social-feed: unexpected error", err instanceof Error ? err.message : "unknown_error");
    body = { posts: [], updatedAt: null, checkedAt: null, stale: true, status: DEFAULT_STATUS, fetchFailed: true };
  }

  return new Response(JSON.stringify(body), {
    status: 200,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      // 定期同期（3分ごと）の結果を投稿から5分以内に届けるため、ブラウザ・エッジとも30秒だけ
      // キャッシュする。中身はKVを読むだけの軽い処理のため、短いキャッシュでも負荷は小さい。
      "Cache-Control": "public, max-age=30, s-maxage=30, stale-while-revalidate=60",
    },
  });
}

export const onRequestGet: PagesFunction<SocialSyncEnv> = async (context) => handleGet(context);

export const onRequest: PagesFunction<SocialSyncEnv> = async (context) => {
  if (context.request.method !== "GET") {
    return new Response(JSON.stringify({ ok: false, error: "method_not_allowed" }), {
      status: 405,
      headers: { "Content-Type": "application/json; charset=utf-8", Allow: "GET" },
    });
  }
  return handleGet(context);
};
