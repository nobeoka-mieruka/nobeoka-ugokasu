// 公開API（functions/api/youtube-feed.ts）から呼び出される、表示用データの組み立て役です。
// Cloudflare KVに保存済みのキャッシュが新しければそれを返し、古くなっていれば
// その場でYouTube Data APIへ取得しにいきます。取得に失敗した場合は、直前のキャッシュが
// あればそれを返し、無ければ空の結果を返します（/activities・/api/social-feedと同じ設計）。

import type { YoutubeFeedResponse, YoutubeFeedStatus } from "../src/types/youtube";
import type { SocialSyncEnv } from "./env";
import { readYoutubeCache } from "./youtubeKv";
import { runYoutubeSync, summarizeYoutubeSyncForLog } from "./youtubeSync";

/** キャッシュをどれだけの間「新しい」とみなすか。動画は投稿頻度が低いため30分程度で十分 */
const FRESH_TTL_MS = 30 * 60 * 1000;

function channelUrl(env: SocialSyncEnv): string | null {
  return env.YOUTUBE_CHANNEL_ID ? `https://www.youtube.com/channel/${encodeURIComponent(env.YOUTUBE_CHANNEL_ID)}` : null;
}

export async function getYoutubeFeed(env: SocialSyncEnv): Promise<YoutubeFeedResponse> {
  const cached = await readYoutubeCache(env);
  const cachedAgeMs = cached ? Date.now() - Date.parse(cached.updatedAt) : Number.POSITIVE_INFINITY;

  if (cached && cachedAgeMs < FRESH_TTL_MS) {
    return { videos: cached.videos, updatedAt: cached.updatedAt, stale: false, status: "ok", fetchFailed: false, channelUrl: channelUrl(env) };
  }

  const result = await runYoutubeSync(env);

  if (result.ok) {
    return { videos: result.videos, updatedAt: result.updatedAt, stale: false, status: "ok", fetchFailed: false, channelUrl: channelUrl(env) };
  }

  if (result.error) {
    // ページ訪問をきっかけにした自動同期の失敗も、原因調査ができるようログへ残す
    // （APIキー等の秘密情報は含まない。server/youtubeSync.tsのsummarizeYoutubeSyncForLog参照）。
    // eslint-disable-next-line no-console
    console.error(JSON.stringify(summarizeYoutubeSyncForLog(result)));
  }

  const status: YoutubeFeedStatus = !result.attempted ? "not_configured" : result.error ? "error" : "ok";
  return {
    videos: result.videos,
    updatedAt: result.updatedAt,
    stale: result.videos.length > 0,
    status,
    fetchFailed: result.attempted && result.error !== null,
    channelUrl: channelUrl(env),
  };
}
