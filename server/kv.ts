import type { SocialFeedStatus, SocialPost } from "../src/types/social";
import type { SocialSyncEnv } from "./env";

/** KVに保存するキャッシュ本体のキー（投稿一覧。内容が変わったときだけ書き込む） */
const CACHE_KEY = "social-posts:cache:v1";
/** 定期同期の実行状況（毎回書き込む小さな値） */
const HEARTBEAT_KEY = "social-posts:heartbeat:v1";

export interface SocialPostsCache {
  posts: SocialPost[];
  /** 投稿一覧の内容を最後に保存した日時（ISO 8601） */
  updatedAt: string;
  /** プラットフォームごとの直近の同期状態 */
  status: SocialFeedStatus;
  /** 投稿一覧の内容から作った署名（変化の検知用） */
  signature?: string;
}

export interface SocialSyncHeartbeat {
  /** 最後に同期を実行した日時（成功・失敗を問わない） */
  checkedAt: string;
  /** 最後にいずれかのSNSから取得が成功した日時 */
  lastSuccessAt: string | null;
  status: SocialFeedStatus;
}

const DEFAULT_STATUS: SocialFeedStatus = { facebook: "not_configured", instagram: "not_configured", threads: "not_configured" };

/** 保存されているキャッシュを読み込む。存在しない・壊れている場合はnull */
export async function readCache(env: SocialSyncEnv): Promise<SocialPostsCache | null> {
  try {
    const value = await env.SOCIAL_POSTS_KV.get<SocialPostsCache>(CACHE_KEY, "json");
    if (!value || !Array.isArray(value.posts)) return null;
    return { ...value, status: value.status ?? DEFAULT_STATUS };
  } catch {
    return null;
  }
}

/** 投稿一覧に変化があったときだけ呼び出す（KVの書き込み回数を抑えるため） */
export async function writeCache(
  env: SocialSyncEnv,
  posts: SocialPost[],
  status: SocialFeedStatus,
  signature: string,
): Promise<SocialPostsCache> {
  const cache: SocialPostsCache = { posts, updatedAt: new Date().toISOString(), status, signature };
  await env.SOCIAL_POSTS_KV.put(CACHE_KEY, JSON.stringify(cache));
  return cache;
}

export async function readHeartbeat(env: SocialSyncEnv): Promise<SocialSyncHeartbeat | null> {
  try {
    return await env.SOCIAL_POSTS_KV.get<SocialSyncHeartbeat>(HEARTBEAT_KEY, "json");
  } catch {
    return null;
  }
}

export async function writeHeartbeat(env: SocialSyncEnv, heartbeat: SocialSyncHeartbeat): Promise<void> {
  await env.SOCIAL_POSTS_KV.put(HEARTBEAT_KEY, JSON.stringify(heartbeat));
}

/**
 * 公開API・ビルド時スナップショット向けに、表示に必要な項目だけへ整える。
 * SNS側の期限付き画像URL（imageUrl/thumbnailUrl）と内部用の imageSource は出力しない。
 */
export function toPublicPost(post: SocialPost): SocialPost {
  const { imageSource: _imageSource, ...rest } = post;
  return { ...rest, imageUrl: null, thumbnailUrl: null, localImage: post.localImage ?? null };
}

/**
 * 投稿一覧の内容から署名を作る。投稿の追加・削除・本文の編集・画像の差し替えのいずれかで変わる。
 * scripts/social-signature.mjs と同じ計算方法（ビルド済みの内容との差分検知に使う）。
 */
export function postsSignature(posts: SocialPost[]): string {
  // 並び順に左右されないよう、SNS名・投稿IDの順に並べてから計算する
  const material = [...posts]
    .sort((a, b) => `${a.platform}:${a.id}`.localeCompare(`${b.platform}:${b.id}`))
    .map((p) => [p.platform, p.id, p.publishedAt, p.title, p.description, p.permalink, p.localImage?.src ?? "", p.mediaCount ?? 1].join("\u0001"))
    .join("\u0002");
  let hash = 0x811c9dc5;
  for (let i = 0; i < material.length; i++) {
    hash ^= material.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return `${posts.length}-${(hash >>> 0).toString(16).padStart(8, "0")}`;
}
