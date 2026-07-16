// GET /api/social-posts
// ホームページの「活動報告」ページから読み込む公開APIです。
// KVに保存済みのキャッシュだけを返し、Meta Graph APIへは直接アクセスしません。
// アクセストークンや内部IDなど、表示に不要な情報は一切含めません。

import type { SocialPostsResponse } from "../../src/types/social";
import type { SocialSyncEnv } from "../../server/env";
import { readCache } from "../../server/kv";

export const onRequestGet: PagesFunction<SocialSyncEnv> = async (context) => {
  let body: SocialPostsResponse;

  try {
    const cache = await readCache(context.env);
    body = cache
      ? { posts: cache.posts, updatedAt: cache.updatedAt, stale: false }
      : { posts: [], updatedAt: null, stale: false };
  } catch {
    // KVバインディング未設定など、想定外の問題が起きても、ページ全体を壊さないよう空の結果を返す
    body = { posts: [], updatedAt: null, stale: true };
  }

  return new Response(JSON.stringify(body), {
    status: 200,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      // 30分ごとの同期に対して、5分キャッシュ＋古いキャッシュの一時提供を許容する
      "Cache-Control": "public, max-age=300, stale-while-revalidate=1800",
    },
  });
};
