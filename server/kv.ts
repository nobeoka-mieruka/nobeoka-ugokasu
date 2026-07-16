import type { SocialPost } from "../src/types/social";
import type { SocialSyncEnv } from "./env";

/** KVに保存するキャッシュ本体のキー */
const CACHE_KEY = "social-posts:cache:v1";

export interface SocialPostsCache {
  posts: SocialPost[];
  /** 最後に同期が成功した日時（ISO 8601） */
  updatedAt: string;
}

/** 保存されているキャッシュを読み込む。存在しない・壊れている場合はnull */
export async function readCache(env: SocialSyncEnv): Promise<SocialPostsCache | null> {
  try {
    const value = await env.SOCIAL_POSTS_KV.get<SocialPostsCache>(CACHE_KEY, "json");
    if (!value || !Array.isArray(value.posts)) return null;
    return value;
  } catch {
    return null;
  }
}

/** 同期が成功したときだけ呼び出す。失敗時にはこの関数自体を呼ばないことで、既存キャッシュを保護する */
export async function writeCache(env: SocialSyncEnv, posts: SocialPost[]): Promise<SocialPostsCache> {
  const cache: SocialPostsCache = {
    posts,
    updatedAt: new Date().toISOString(),
  };
  await env.SOCIAL_POSTS_KV.put(CACHE_KEY, JSON.stringify(cache));
  return cache;
}
