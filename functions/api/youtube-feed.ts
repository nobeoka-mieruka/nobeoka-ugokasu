// GET /api/youtube-feed
// ホームページ・/videosページから読み込む公開APIです。Cloudflare KVのキャッシュが
// 新しければそのまま返し、古い場合はこの中でYouTube Data API v3へ取得しにいきます
// （server/youtubeFeed.ts参照）。APIキー・YouTubeの生レスポンス・内部エラー詳細など、
// 表示に不要な情報は一切含めません（返すのは正規化済みの動画一覧と状態のみ）。

import type { YoutubeFeedResponse, YoutubeFeedStatus } from "../../src/types/youtube";
import type { SocialSyncEnv } from "../../server/env";
import { getYoutubeFeed } from "../../server/youtubeFeed";

const DEFAULT_STATUS: YoutubeFeedStatus = "not_configured";

async function handleGet(context: Parameters<PagesFunction<SocialSyncEnv>>[0]): Promise<Response> {
  let body: YoutubeFeedResponse;

  try {
    body = await getYoutubeFeed(context.env);
  } catch (err) {
    // KVバインディング未設定など、想定外の問題が起きても、ページ全体を壊さないよう空の結果を返す。
    // 原因調査のため、エラーメッセージのみ（秘密情報は含まない）Cloudflare Functionsログへ残す。
    // eslint-disable-next-line no-console
    console.error("youtube-feed: unexpected error", err instanceof Error ? err.message : "unknown_error");
    body = { videos: [], updatedAt: null, stale: true, status: DEFAULT_STATUS, fetchFailed: true, channelUrl: null };
  }

  return new Response(JSON.stringify(body), {
    status: 200,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      // 動画はSNS投稿ほど更新頻度が高くないため、30分程度のエッジキャッシュを許容する。
      "Cache-Control": "public, max-age=300, s-maxage=1800, stale-while-revalidate=86400",
    },
  });
}

export const onRequestGet: PagesFunction<SocialSyncEnv> = async (context) => handleGet(context);

export const onRequest: PagesFunction<SocialSyncEnv> = async (context) => {
  if (context.request.method !== "GET") {
    return new Response(JSON.stringify({ ok: false, error: "method_not_allowed" }), {
      status: 405,
      headers: { "Content-Type": "application/json; charset=utf-8", Allow: "GET" },
    });
  }
  return handleGet(context);
};
