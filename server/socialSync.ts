import type { SocialPost } from "../src/types/social";
import type { SocialSyncEnv } from "./env";
import { fetchFacebookPosts, fetchInstagramMedia } from "./metaClient";
import { normalizeFacebookPost, normalizeInstagramMedia } from "./normalize";
import { writeCache } from "./kv";

const DEFAULT_POST_LIMIT = 12;

function parseLimit(value: string | undefined): number {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_POST_LIMIT;
}

/** 同一投稿の重複を防ぐ。permalinkが完全一致するものを1件だけ残す */
function dedupeByPermalink(posts: SocialPost[]): SocialPost[] {
  const seen = new Set<string>();
  const result: SocialPost[] = [];
  for (const post of posts) {
    const key = post.permalink || `${post.platform}:${post.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(post);
  }
  return result;
}

export interface SocialSyncResult {
  ok: boolean;
  facebookFetched: number;
  instagramFetched: number;
  savedCount: number;
  facebookError: string | null;
  instagramError: string | null;
  skippedReason?: string;
}

/**
 * Facebook・Instagramの投稿を取得し、KVキャッシュを更新する。
 * Cron Worker（30分ごと）と、管理者向け手動同期エンドポイントの両方から呼び出される。
 *
 * 方針：
 * - 認証情報が未設定のプラットフォームは呼び出さずスキップする（エラーにしない）
 * - 一方のプラットフォームが失敗しても、もう一方の結果だけで同期を継続する
 * - 両方とも取得に失敗した場合は、既存のキャッシュを一切変更しない
 */
export async function runSocialSync(env: SocialSyncEnv): Promise<SocialSyncResult> {
  const limit = parseLimit(env.SOCIAL_POST_LIMIT);
  const apiVersion = env.META_GRAPH_API_VERSION;

  let facebookPosts: SocialPost[] = [];
  let facebookError: string | null = null;
  let facebookAttempted = false;

  if (env.FACEBOOK_PAGE_ID && env.FACEBOOK_PAGE_ACCESS_TOKEN) {
    facebookAttempted = true;
    try {
      const raw = await fetchFacebookPosts({
        pageId: env.FACEBOOK_PAGE_ID,
        accessToken: env.FACEBOOK_PAGE_ACCESS_TOKEN,
        apiVersion,
        limit,
      });
      facebookPosts = raw.map(normalizeFacebookPost).filter((p): p is SocialPost => p !== null);
    } catch (err) {
      facebookError = err instanceof Error ? err.message : "unknown_error";
    }
  }

  let instagramPosts: SocialPost[] = [];
  let instagramError: string | null = null;
  let instagramAttempted = false;

  if (env.INSTAGRAM_BUSINESS_ACCOUNT_ID && env.INSTAGRAM_ACCESS_TOKEN) {
    instagramAttempted = true;
    try {
      const raw = await fetchInstagramMedia({
        businessAccountId: env.INSTAGRAM_BUSINESS_ACCOUNT_ID,
        accessToken: env.INSTAGRAM_ACCESS_TOKEN,
        apiVersion,
        limit,
      });
      instagramPosts = raw.map(normalizeInstagramMedia).filter((p): p is SocialPost => p !== null);
    } catch (err) {
      instagramError = err instanceof Error ? err.message : "unknown_error";
    }
  }

  const facebookSucceeded = facebookAttempted && facebookError === null;
  const instagramSucceeded = instagramAttempted && instagramError === null;

  const baseResult = {
    facebookFetched: facebookPosts.length,
    instagramFetched: instagramPosts.length,
    facebookError,
    instagramError,
  };

  if (!facebookAttempted && !instagramAttempted) {
    return { ok: false, ...baseResult, savedCount: 0, skippedReason: "no_credentials_configured" };
  }

  if (!facebookSucceeded && !instagramSucceeded) {
    // どちらも失敗（未設定ではなく実際にエラー）。既存キャッシュは変更しない。
    return { ok: false, ...baseResult, savedCount: 0, skippedReason: "all_platforms_failed" };
  }

  const merged = dedupeByPermalink([...facebookPosts, ...instagramPosts])
    .sort((a, b) => new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime())
    .slice(0, limit);

  await writeCache(env, merged);

  return { ok: true, ...baseResult, savedCount: merged.length };
}

/** アクセストークン等の秘密情報を含めない、ログ出力用の要約を作る */
export function summarizeForLog(result: SocialSyncResult): Record<string, unknown> {
  return {
    event: "social-sync",
    syncedAt: new Date().toISOString(),
    ok: result.ok,
    facebookFetched: result.facebookFetched,
    instagramFetched: result.instagramFetched,
    savedCount: result.savedCount,
    facebookError: result.facebookError,
    instagramError: result.instagramError,
    skippedReason: result.skippedReason ?? null,
  };
}
