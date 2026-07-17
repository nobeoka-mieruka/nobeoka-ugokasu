// GET /api/social-posts
// ホームページの「活動報告」ページから読み込む公開APIです。
// KVに保存済みのキャッシュだけを返し、Meta Graph APIへは直接アクセスしません。
// アクセストークン・Meta APIの生レスポンス・内部エラー詳細など、表示に不要な情報は
// 一切含めません（返すのは正規化済みの投稿一覧とプラットフォームごとの状態のみ）。

import type { SocialFeedStatus, SocialPostsResponse } from "../../src/types/social";
import type { SocialSyncEnv } from "../../server/env";
import { readCache } from "../../server/kv";

const DEFAULT_STATUS: SocialFeedStatus = { facebook: "not_configured", instagram: "not_configured" };

async function handleGet(context: Parameters<PagesFunction<SocialSyncEnv>>[0]): Promise<Response> {
  let body: SocialPostsResponse;

  try {
    const cache = await readCache(context.env);
    body = cache
      ? { posts: cache.posts, updatedAt: cache.updatedAt, stale: false, status: cache.status }
      : { posts: [], updatedAt: null, stale: false, status: DEFAULT_STATUS };
  } catch {
    // KVバインディング未設定など、想定外の問題が起きても、ページ全体を壊さないよう空の結果を返す
    body = { posts: [], updatedAt: null, stale: true, status: DEFAULT_STATUS };
  }

  return new Response(JSON.stringify(body), {
    status: 200,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      // Meta APIへのアクセス回数を抑えるため、10〜15分程度のキャッシュを許容する。
      // s-maxage=900（Cloudflareエッジで15分）、stale-while-revalidateで
      // 同期が遅延・失敗していても古いキャッシュの提供を継続する。
      "Cache-Control": "public, max-age=300, s-maxage=900, stale-while-revalidate=86400",
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
