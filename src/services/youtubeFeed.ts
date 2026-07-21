// ブラウザから /api/youtube-feed を読み込むためのクライアント側ヘルパーです。
// APIキー等の秘密情報はここには一切含まれません
//（この関数は取得済みの表示用データを読むだけです）。

import type { YoutubeFeedStatus, YoutubeVideo, YoutubeFeedResponse } from "../types/youtube";

export interface YoutubeFeedResult {
  videos: YoutubeVideo[];
  updatedAt: string | null;
  /** trueの場合、YouTube APIへの取得自体が（認証情報はあるのに）失敗したことを示す */
  fetchFailed: boolean;
  status: YoutubeFeedStatus;
  channelUrl: string | null;
}

const FAILED_RESULT: YoutubeFeedResult = {
  videos: [],
  updatedAt: null,
  fetchFailed: true,
  status: "not_configured",
  channelUrl: null,
};

export async function fetchYoutubeFeed(): Promise<YoutubeFeedResult> {
  try {
    const res = await fetch("/api/youtube-feed", { headers: { Accept: "application/json" } });
    if (!res.ok) return FAILED_RESULT;
    const data = (await res.json()) as YoutubeFeedResponse;
    if (!Array.isArray(data.videos)) return FAILED_RESULT;
    return {
      videos: data.videos,
      updatedAt: data.updatedAt ?? null,
      fetchFailed: Boolean(data.fetchFailed),
      status: data.status ?? "not_configured",
      channelUrl: data.channelUrl ?? null,
    };
  } catch {
    return FAILED_RESULT;
  }
}
