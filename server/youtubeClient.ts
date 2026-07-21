// YouTube Data API v3から、チャンネルのアップロード用プレイリストの動画一覧を
// 取得するための最小限のクライアントです。APIキーはcrawler等に渡さず、
// このモジュール内でのみ使用します。

const PLAYLIST_ITEMS_URL = "https://www.googleapis.com/youtube/v3/playlistItems";

interface YoutubeThumbnail {
  url?: string;
}

interface YoutubeThumbnails {
  default?: YoutubeThumbnail;
  medium?: YoutubeThumbnail;
  high?: YoutubeThumbnail;
  standard?: YoutubeThumbnail;
  maxres?: YoutubeThumbnail;
}

interface PlaylistItemSnippet {
  title?: string;
  description?: string;
  publishedAt?: string;
  channelTitle?: string;
  thumbnails?: YoutubeThumbnails;
  resourceId?: { videoId?: string };
}

interface PlaylistItemContentDetails {
  videoId?: string;
  videoPublishedAt?: string;
}

interface PlaylistItemRaw {
  snippet?: PlaylistItemSnippet;
  contentDetails?: PlaylistItemContentDetails;
}

/**
 * YouTube Data APIがエラー時に返すerrorオブジェクト。
 * 注意：他社Graph APIでmessageにトークン文字列が混入する事例が実際に確認されているため、
 * 念のためこちらもログへ渡す前に必ずredactSecrets()を通す。
 */
interface YoutubeApiError {
  code?: number;
  message?: string;
  errors?: { reason?: string; message?: string }[];
}

interface PlaylistItemsResponse {
  items?: PlaylistItemRaw[];
  error?: YoutubeApiError;
}

export interface YoutubePlaylistItemRaw {
  videoId: string;
  title: string;
  description: string;
  publishedAt: string;
  thumbnailUrl: string;
  channelTitle: string;
}

/** APIキー等の秘密情報がエラーメッセージへ紛れ込んでいた場合に備えて伏せ字化する */
function redactSecrets(text: string): string {
  return text.replace(/[A-Za-z0-9_-]{20,}/g, "[REDACTED]");
}

/** ログ出力用に、原因特定に必要な範囲だけを安全な文字列へまとめる（APIキーは含まない） */
function describeYoutubeApiError(httpStatus: number, error: YoutubeApiError | undefined): string {
  const detail = {
    httpStatus,
    code: error?.code ?? null,
    reason: error?.errors?.[0]?.reason ?? null,
    message: error?.message ? redactSecrets(error.message.slice(0, 300)) : null,
  };
  return JSON.stringify(detail);
}

function pickThumbnailUrl(thumbnails: YoutubeThumbnails | undefined): string {
  return (
    thumbnails?.maxres?.url ??
    thumbnails?.standard?.url ??
    thumbnails?.high?.url ??
    thumbnails?.medium?.url ??
    thumbnails?.default?.url ??
    ""
  );
}

export async function fetchYoutubeUploads(params: {
  playlistId: string;
  apiKey: string;
  maxResults: number;
}): Promise<YoutubePlaylistItemRaw[]> {
  const url =
    `${PLAYLIST_ITEMS_URL}?part=${encodeURIComponent("snippet,contentDetails")}` +
    `&playlistId=${encodeURIComponent(params.playlistId)}` +
    `&maxResults=${params.maxResults}` +
    `&key=${encodeURIComponent(params.apiKey)}`;

  const res = await fetch(url);
  const body = (await res.json()) as PlaylistItemsResponse;

  if (!res.ok || body.error) {
    throw new Error(`youtube_api_error:${describeYoutubeApiError(res.status, body.error)}`);
  }

  const items = body.items ?? [];
  const parsed: YoutubePlaylistItemRaw[] = [];
  for (const item of items) {
    const videoId = item.contentDetails?.videoId ?? item.snippet?.resourceId?.videoId;
    if (!videoId) continue;
    parsed.push({
      videoId,
      title: item.snippet?.title ?? "",
      description: item.snippet?.description ?? "",
      publishedAt: item.contentDetails?.videoPublishedAt ?? item.snippet?.publishedAt ?? new Date().toISOString(),
      thumbnailUrl: pickThumbnailUrl(item.snippet?.thumbnails),
      channelTitle: item.snippet?.channelTitle ?? "",
    });
  }
  return parsed;
}
