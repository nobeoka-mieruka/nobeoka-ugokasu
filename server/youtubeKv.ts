import type { YoutubeVideo } from "../src/types/youtube";
import type { SocialSyncEnv } from "./env";

// Facebook/Instagram用のSOCIAL_POSTS_KVと同じKV名前空間を、別のキーで共用する。
// 動画一覧のためだけに新しいKV名前空間をCloudflare側で追加作成する必要をなくすため。
const CACHE_KEY = "youtube-feed:cache:v1";

export interface YoutubeFeedCache {
  videos: YoutubeVideo[];
  /** 最後に同期が成功した日時（ISO 8601） */
  updatedAt: string;
}

/** 保存されているキャッシュを読み込む。存在しない・壊れている場合はnull */
export async function readYoutubeCache(env: SocialSyncEnv): Promise<YoutubeFeedCache | null> {
  try {
    const value = await env.SOCIAL_POSTS_KV.get<YoutubeFeedCache>(CACHE_KEY, "json");
    if (!value || !Array.isArray(value.videos)) return null;
    return value;
  } catch {
    return null;
  }
}

/** 同期が成功したときだけ呼び出す。失敗時にはこの関数自体を呼ばないことで、既存キャッシュを保護する */
export async function writeYoutubeCache(env: SocialSyncEnv, videos: YoutubeVideo[]): Promise<YoutubeFeedCache> {
  const cache: YoutubeFeedCache = {
    videos,
    updatedAt: new Date().toISOString(),
  };
  await env.SOCIAL_POSTS_KV.put(CACHE_KEY, JSON.stringify(cache));
  return cache;
}
