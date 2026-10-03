import type { PlatformSyncStatus, SocialFeedStatus, SocialPost } from "../src/types/social";
import type { SocialSyncEnv } from "./env";
import { fetchFacebookPosts, fetchInstagramMedia } from "./metaClient";
import { fetchThreadsPosts } from "./threadsClient";
import { normalizeFacebookPost, normalizeInstagramMedia, normalizeThreadsPost } from "./normalize";
import { postsSignature, readCache, readHeartbeat, writeCache, writeHeartbeat } from "./kv";
import { mirrorPostImages } from "./socialImages";

// プラットフォームごとの取得件数（既定6件）。SOCIAL_POST_LIMITで上書き可能。
// Facebook・Instagram・Threadsそれぞれ最大この件数まで取得するため、合算後の最大件数は
// この3倍（既定18件）になる。
const DEFAULT_POST_LIMIT = 6;

function parseLimit(value: string | undefined): number {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_POST_LIMIT;
}

/**
 * 同一投稿の重複を防ぐ。同じSNSの同じ投稿ID、または同じpermalinkのものは
 * 先に現れた1件（＝今回新しく取得した方）だけを残す。
 */
export function dedupePosts(posts: SocialPost[]): SocialPost[] {
  const seen = new Set<string>();
  const result: SocialPost[] = [];
  for (const post of posts) {
    const idKey = `id:${post.platform}:${post.id}`;
    const linkKey = post.permalink ? `link:${post.permalink}` : null;
    if (seen.has(idKey) || (linkKey && seen.has(linkKey))) continue;
    seen.add(idKey);
    if (linkKey) seen.add(linkKey);
    result.push(post);
  }
  return result;
}

type PlatformOutcome = { attempted: boolean; posts: SocialPost[]; error: string | null };

/** 1つのSNSの取得を実行する。例外はここで受け止め、他のSNSの処理へ影響させない */
async function fetchPlatform(enabled: boolean, run: () => Promise<SocialPost[]>): Promise<PlatformOutcome> {
  if (!enabled) return { attempted: false, posts: [], error: null };
  try {
    return { attempted: true, posts: await run(), error: null };
  } catch (err) {
    return { attempted: true, posts: [], error: err instanceof Error ? err.message : "unknown_error" };
  }
}

export interface SocialSyncResult {
  ok: boolean;
  /** 表示に使うべき投稿一覧。成功時は新規取得分、全滅時は直前のキャッシュのフォールバック */
  posts: SocialPost[];
  status: SocialFeedStatus;
  /** 最後にいずれかのSNSから取得が成功した日時（ISO 8601）。一度も成功していない場合はnull */
  updatedAt: string | null;
  /** 今回の同期を実行した日時 */
  checkedAt: string;
  /** 投稿一覧（本文・画像を含む）が前回から変化したか */
  changed: boolean;
  facebookFetched: number;
  instagramFetched: number;
  threadsFetched: number;
  savedCount: number;
  imagesDownloaded: number;
  imagesFailed: number;
  facebookError: string | null;
  instagramError: string | null;
  threadsError: string | null;
  skippedReason?: string;
}

/**
 * Facebook・Instagram・Threadsの投稿を取得し、画像をKVへ保存したうえでキャッシュを更新する。
 * 定期実行（worker/social-cron → /api/admin/sync-social-posts）と、管理者の手動同期から呼び出される。
 * 閲覧者のアクセスをきっかけに実行されることはない（/api/social-feed は保存済みの結果を読むだけ）。
 *
 * 方針：
 * - 認証情報が未設定のプラットフォームは呼び出さずスキップする（エラーにしない）
 * - SNSごとに取得を分離し、1つが失敗しても他のSNSの結果だけで更新する
 * - 失敗・未設定のSNSは、直前に正常取得できていた投稿をそのまま引き継ぐ（last known good）
 * - 投稿一覧の内容が変わったときだけキャッシュを書き込む（変化が無ければ書き込まない）
 */
export async function runSocialSync(env: SocialSyncEnv): Promise<SocialSyncResult> {
  const limit = parseLimit(env.SOCIAL_POST_LIMIT);
  const apiVersion = env.META_GRAPH_API_VERSION;
  const token = env.META_ACCESS_TOKEN;
  const checkedAt = new Date().toISOString();
  const [previous, previousHeartbeat] = await Promise.all([readCache(env), readHeartbeat(env)]);

  // 3つのSNSは互いに独立して同時に取得する（1つの失敗・遅延が他へ波及しない）
  const [facebook, instagram, threads] = await Promise.all([
    fetchPlatform(Boolean(env.FACEBOOK_PAGE_ID && token), async () => {
      const raw = await fetchFacebookPosts({ pageId: env.FACEBOOK_PAGE_ID!, accessToken: token!, apiVersion, limit });
      return raw.map(normalizeFacebookPost).filter((p): p is SocialPost => p !== null);
    }),
    fetchPlatform(Boolean(env.INSTAGRAM_USER_ID && token), async () => {
      const raw = await fetchInstagramMedia({ userId: env.INSTAGRAM_USER_ID!, accessToken: token!, apiVersion, limit });
      return raw.map(normalizeInstagramMedia).filter((p): p is SocialPost => p !== null);
    }),
    // Threads APIはgraph.threads.netという別ホスト・別トークン（THREADS_ACCESS_TOKEN）のため、
    // Facebook/Instagram用のMETA_ACCESS_TOKENとは独立して認証情報を確認する。
    fetchPlatform(Boolean(env.THREADS_USER_ID && env.THREADS_ACCESS_TOKEN), async () => {
      const raw = await fetchThreadsPosts({ userId: env.THREADS_USER_ID!, accessToken: env.THREADS_ACCESS_TOKEN!, limit });
      return raw.map(normalizeThreadsPost).filter((p): p is SocialPost => p !== null);
    }),
  ]);

  const succeeded = (o: PlatformOutcome) => o.attempted && o.error === null;
  const status: SocialFeedStatus = {
    facebook: statusFor(facebook.attempted, succeeded(facebook)),
    instagram: statusFor(instagram.attempted, succeeded(instagram)),
    threads: statusFor(threads.attempted, succeeded(threads)),
  };
  const anySucceeded = succeeded(facebook) || succeeded(instagram) || succeeded(threads);
  const lastSuccessAt = anySucceeded ? checkedAt : (previousHeartbeat?.lastSuccessAt ?? null);

  const baseResult = {
    checkedAt,
    facebookFetched: facebook.posts.length,
    instagramFetched: instagram.posts.length,
    threadsFetched: threads.posts.length,
    facebookError: facebook.error,
    instagramError: instagram.error,
    threadsError: threads.error,
  };

  const previousPosts = previous?.posts ?? [];

  if (!anySucceeded) {
    // 全SNSが未設定または失敗。保存済みの投稿は一切変更せず、実行状況だけを記録する。
    await writeHeartbeat(env, { checkedAt, lastSuccessAt, status });
    const noneAttempted = !facebook.attempted && !instagram.attempted && !threads.attempted;
    return {
      ok: false,
      ...baseResult,
      posts: previousPosts,
      status,
      updatedAt: lastSuccessAt,
      changed: false,
      savedCount: 0,
      imagesDownloaded: 0,
      imagesFailed: 0,
      skippedReason: noneAttempted ? "no_credentials_configured" : "all_platforms_failed",
    };
  }

  // 失敗・未設定のSNSは、直前まで表示できていた投稿をキャッシュから引き継ぐ
  // （一時的なAPI障害でも、そのSNSの投稿が突然消えないようにするため）。
  const carried = (platform: SocialPost["platform"], o: PlatformOutcome) =>
    succeeded(o)
      ? []
      : previousPosts
          .filter((p) => p.platform === platform)
          // 引き継いだ投稿の元画像URLは期限切れの可能性が高いため再取得しない（保存済みの画像だけを使う）
          .map((p) => ({ ...p, imageUrl: null, thumbnailUrl: null }));

  const merged = dedupePosts([
    ...facebook.posts,
    ...instagram.posts,
    ...threads.posts,
    ...carried("facebook", facebook),
    ...carried("instagram", instagram),
    ...carried("threads", threads),
  ])
    .sort((a, b) => new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime())
    .slice(0, limit * 3);

  const mirrored = await mirrorPostImages(env, merged, previousPosts);
  const signature = postsSignature(mirrored.posts);
  const changed = signature !== (previous?.signature ?? postsSignature(previousPosts)) || !previous;

  if (changed || statusChanged(previous?.status, status)) {
    await writeCache(env, mirrored.posts, status, signature);
  }
  await writeHeartbeat(env, { checkedAt, lastSuccessAt, status });

  return {
    ok: true,
    ...baseResult,
    posts: mirrored.posts,
    status,
    updatedAt: lastSuccessAt,
    changed,
    savedCount: mirrored.posts.length,
    imagesDownloaded: mirrored.downloaded,
    imagesFailed: mirrored.failed,
  };
}

function statusChanged(a: SocialFeedStatus | undefined, b: SocialFeedStatus): boolean {
  return !a || a.facebook !== b.facebook || a.instagram !== b.instagram || a.threads !== b.threads;
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
    threadsFetched: result.threadsFetched,
    savedCount: result.savedCount,
    changed: result.changed,
    imagesDownloaded: result.imagesDownloaded,
    imagesFailed: result.imagesFailed,
    facebookError: result.facebookError,
    instagramError: result.instagramError,
    threadsError: result.threadsError,
    skippedReason: result.skippedReason ?? null,
  };
}
