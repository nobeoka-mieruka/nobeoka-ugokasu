// 公開API（functions/api/social-feed.ts）から呼び出される、表示用データの組み立て役です。
// Cloudflare KVに保存済みのキャッシュが新しければそれを返し、古くなっていれば
// その場でMeta Graph APIへ取得しにいきます（アクセスのたびに毎回Meta APIへ
// 問い合わせることを避けるため）。取得に失敗した場合は、直前のキャッシュがあれば
// それを返し、無ければ空の結果を返します。

import type { SocialFeedStatus, SocialPostsResponse } from "../src/types/social";
import type { SocialSyncEnv } from "./env";
import { readCache } from "./kv";
import { runSocialSync } from "./socialSync";

/** キャッシュをどれだけの間「新しい」とみなすか（10〜15分の目安の中央値） */
const FRESH_TTL_MS = 12 * 60 * 1000;

const DEFAULT_STATUS: SocialFeedStatus = { facebook: "not_configured", instagram: "not_configured" };

export async function getSocialFeed(env: SocialSyncEnv): Promise<SocialPostsResponse> {
  const cached = await readCache(env);
  const cachedAgeMs = cached ? Date.now() - Date.parse(cached.updatedAt) : Number.POSITIVE_INFINITY;

  if (cached && cachedAgeMs < FRESH_TTL_MS) {
    return { posts: cached.posts, updatedAt: cached.updatedAt, stale: false, status: cached.status, fetchFailed: false };
  }

  const result = await runSocialSync(env);

  if (result.ok) {
    return { posts: result.posts, updatedAt: result.updatedAt, stale: false, status: result.status, fetchFailed: false };
  }

  // 取得できなかった（未設定 or 失敗）。previousキャッシュがあればそれを返す。
  const fetchFailed = result.skippedReason === "all_platforms_failed";
  return {
    posts: result.posts,
    updatedAt: result.updatedAt,
    stale: result.posts.length > 0,
    status: result.status ?? DEFAULT_STATUS,
    fetchFailed,
  };
}
