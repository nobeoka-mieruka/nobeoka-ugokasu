import type { PlatformSyncStatus, SocialFeedStatus, SocialPost } from "../src/types/social";
import type { SocialSyncEnv } from "./env";
import { fetchFacebookPosts, fetchInstagramMedia } from "./metaClient";
import { normalizeFacebookPost, normalizeInstagramMedia } from "./normalize";
import { readCache, writeCache } from "./kv";

// プラットフォームごとの取得件数（既定6件）。SOCIAL_POST_LIMITで上書き可能。
// FacebookとInstagramそれぞれ最大この件数まで取得するため、合算後の最大件数は
// この2倍（既定12件）になる。
const DEFAULT_POST_LIMIT = 6;

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
  /** 表示に使うべき投稿一覧。成功時は新規取得分、全滅時は直前のキャッシュのフォールバック */
  posts: SocialPost[];
  status: SocialFeedStatus;
  /** postsが最後に確定した日時（ISO 8601）。一度もキャッシュが無い場合はnull */
  updatedAt: string | null;
  facebookFetched: number;
  instagramFetched: number;
  savedCount: number;
  facebookError: string | null;
  instagramError: string | null;
  skippedReason?: string;
}

/**
 * Facebook・Instagramの投稿を取得し、KVキャッシュを更新する。
 * 公開API（functions/api/social-feed.ts）がキャッシュを更新する際と、
 * 管理者向け手動同期エンドポイントの両方から呼び出される。
 *
 * 方針：
 * - 認証情報が未設定のプラットフォームは呼び出さずスキップする（エラーにしない）
 * - 一方のプラットフォームが失敗しても、もう一方の結果だけで同期を継続する
 * - 両方とも取得に失敗した場合は、既存のキャッシュを一切変更せず、そのまま返す
 */
export async function runSocialSync(env: SocialSyncEnv): Promise<SocialSyncResult> {
  const limit = parseLimit(env.SOCIAL_POST_LIMIT);
  const apiVersion = env.META_GRAPH_API_VERSION;
  const token = env.META_ACCESS_TOKEN;
  const previous = await readCache(env);

  let facebookPosts: SocialPost[] = [];
  let facebookError: string | null = null;
  let facebookAttempted = false;

  if (env.FACEBOOK_PAGE_ID && token) {
    facebookAttempted = true;
    try {
      const raw = await fetchFacebookPosts({
        pageId: env.FACEBOOK_PAGE_ID,
        accessToken: token,
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

  if (env.INSTAGRAM_USER_ID && token) {
    instagramAttempted = true;
    try {
      const raw = await fetchInstagramMedia({
        userId: env.INSTAGRAM_USER_ID,
        accessToken: token,
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

  const status: SocialFeedStatus = {
    facebook: statusFor(facebookAttempted, facebookSucceeded),
    instagram: statusFor(instagramAttempted, instagramSucceeded),
  };

  const baseResult = {
    facebookFetched: facebookPosts.length,
    instagramFetched: instagramPosts.length,
    facebookError,
    instagramError,
  };

  if (!facebookAttempted && !instagramAttempted) {
    return {
      ok: false,
      ...baseResult,
      posts: previous?.posts ?? [],
      status,
      updatedAt: previous?.updatedAt ?? null,
      savedCount: 0,
      skippedReason: "no_credentials_configured",
    };
  }

  if (!facebookSucceeded && !instagramSucceeded) {
    // どちらも失敗（未設定ではなく実際にエラー）。既存キャッシュは変更せず、そのまま返す。
    return {
      ok: false,
      ...baseResult,
      posts: previous?.posts ?? [],
      status,
      updatedAt: previous?.updatedAt ?? null,
      savedCount: 0,
      skippedReason: "all_platforms_failed",
    };
  }

  // 失敗・未設定のプラットフォームは、直前まで表示できていた投稿をキャッシュから引き継ぐ
  // （一時的なAPI障害でも、そのSNSの投稿が突然消えないようにするため）。
  const previousPosts = previous?.posts ?? [];
  const carriedFacebook = facebookSucceeded ? [] : previousPosts.filter((p) => p.platform === "facebook");
  const carriedInstagram = instagramSucceeded ? [] : previousPosts.filter((p) => p.platform === "instagram");

  const merged = dedupeByPermalink([...facebookPosts, ...instagramPosts, ...carriedFacebook, ...carriedInstagram])
    .sort((a, b) => new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime())
    .slice(0, limit * 2);

  const cache = await writeCache(env, merged, status);

  return { ok: true, ...baseResult, posts: merged, status, updatedAt: cache.updatedAt, savedCount: merged.length };
}

function statusFor(attempted: boolean, succeeded: boolean): PlatformSyncStatus {
  if (!attempted) return "not_configured";
  return succeeded ? "ok" : "error";
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
