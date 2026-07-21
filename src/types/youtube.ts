// YouTubeチャンネルの動画を扱うための共通型定義です。
// フロントエンド（src/services, src/scripts）とサーバー側（server/, functions/）の
// 両方から読み込まれます。APIキー等の秘密情報はこの型には一切含まれません。

/** 表示用に整形済みの動画1件分のデータ */
export interface YoutubeVideo {
  /** YouTube動画ID */
  id: string;
  title: string;
  /** 動画説明文（全文。フロント側で短く切り詰めて表示する） */
  description: string;
  /** 公開日時（ISO 8601形式の文字列） */
  publishedAt: string;
  thumbnailUrl: string;
  /** https://www.youtube.com/watch?v=... 形式の動画URL */
  videoUrl: string;
  channelTitle: string;
}

/**
 * 直近の同期状態。"ok"=正常に取得できた、"error"=認証情報はあるが取得に失敗した、
 * "not_configured"=YouTube連携の環境変数が未設定（正常な状態）。
 */
export type YoutubeFeedStatus = "ok" | "error" | "not_configured";

/** GET /api/youtube-feed が返すレスポンスの形 */
export interface YoutubeFeedResponse {
  videos: YoutubeVideo[];
  /** 最後に同期が成功した日時（ISO 8601）。一度も成功していない場合はnull */
  updatedAt: string | null;
  /** trueの場合、直近の取得に失敗・スキップし、以前のキャッシュを表示していることを示す */
  stale: boolean;
  status: YoutubeFeedStatus;
  /** trueの場合、YouTube APIへの取得自体が（認証情報はあるのに）失敗したことを示す */
  fetchFailed: boolean;
  /** YouTubeチャンネルページのURL（YOUTUBE_CHANNEL_ID設定時のみ。秘密情報ではない） */
  channelUrl: string | null;
}
