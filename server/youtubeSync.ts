import type { YoutubeVideo } from "../src/types/youtube";
import type { SocialSyncEnv } from "./env";
import { fetchYoutubeUploads, type YoutubePlaylistItemRaw } from "./youtubeClient";
import { readYoutubeCache, writeYoutubeCache } from "./youtubeKv";

const DEFAULT_MAX_RESULTS = 6;

function normalizeYoutubeVideo(raw: YoutubePlaylistItemRaw): YoutubeVideo {
  return {
    id: raw.videoId,
    title: raw.title || "YouTube動画",
    description: raw.description,
    publishedAt: raw.publishedAt,
    thumbnailUrl: raw.thumbnailUrl,
    videoUrl: `https://www.youtube.com/watch?v=${encodeURIComponent(raw.videoId)}`,
    channelTitle: raw.channelTitle,
  };
}

export interface YoutubeSyncResult {
  ok: boolean;
  /** 表示に使うべき動画一覧。成功時は新規取得分、失敗時は直前のキャッシュのフォールバック */
  videos: YoutubeVideo[];
  /** postsが最後に確定した日時（ISO 8601）。一度もキャッシュが無い場合はnull */
  updatedAt: string | null;
  attempted: boolean;
  fetchedCount: number;
  error: string | null;
}

/**
 * YouTubeチャンネルのアップロード動画を取得し、KVキャッシュを更新する。
 *
 * 方針：
 * - 認証情報（APIキー・プレイリストID）が未設定の場合は呼び出さずスキップする（エラーにしない）
 * - 取得に失敗した場合は、既存のキャッシュを一切変更せず、そのまま返す
 */
export async function runYoutubeSync(env: SocialSyncEnv): Promise<YoutubeSyncResult> {
  const previous = await readYoutubeCache(env);
  const apiKey = env.YOUTUBE_API_KEY;
  const playlistId = env.YOUTUBE_UPLOADS_PLAYLIST_ID;

  if (!apiKey || !playlistId) {
    return {
      ok: false,
      videos: previous?.videos ?? [],
      updatedAt: previous?.updatedAt ?? null,
      attempted: false,
      fetchedCount: 0,
      error: null,
    };
  }

  try {
    const raw = await fetchYoutubeUploads({ playlistId, apiKey, maxResults: DEFAULT_MAX_RESULTS });
    const videos = raw
      .map(normalizeYoutubeVideo)
      .sort((a, b) => new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime());

    const cache = await writeYoutubeCache(env, videos);

    return { ok: true, videos, updatedAt: cache.updatedAt, attempted: true, fetchedCount: videos.length, error: null };
  } catch (err) {
    return {
      ok: false,
      videos: previous?.videos ?? [],
      updatedAt: previous?.updatedAt ?? null,
      attempted: true,
      fetchedCount: 0,
      error: err instanceof Error ? err.message : "unknown_error",
    };
  }
}

/** アクセストークン等の秘密情報を含めない、ログ出力用の要約を作る */
export function summarizeYoutubeSyncForLog(result: YoutubeSyncResult): Record<string, unknown> {
  return {
    event: "youtube-sync",
    syncedAt: new Date().toISOString(),
    ok: result.ok,
    attempted: result.attempted,
    fetchedCount: result.fetchedCount,
    error: result.error,
  };
}
