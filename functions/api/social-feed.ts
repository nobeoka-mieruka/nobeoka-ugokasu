// GET /api/social-feed
// ホームページの「活動報告」ページから読み込む公開APIです。
// Cloudflare KVのキャッシュが新しければそのまま返し、古い場合はこの中でMeta Graph API
// へ取得しにいきます（server/socialFeed.ts参照）。アクセストークン・Meta APIの生レスポンス・
// 内部エラー詳細など、表示に不要な情報は一切含めません（返すのは正規化済みの投稿一覧と
// プラットフォームごとの状態のみ）。

import type { SocialFeedStatus, SocialPostsResponse } from "../../src/types/social";
import type { SocialSyncEnv } from "../../server/env";
import { getSocialFeed } from "../../server/socialFeed";

const DEFAULT_STATUS: SocialFeedStatus = { facebook: "not_configured", instagram: "not_configured" };

async function handleGet(context: Parameters<PagesFunction<SocialSyncEnv>>[0]): Promise<Response> {
  let body: SocialPostsResponse;

  try {
    body = await getSocialFeed(context.env);
  } catch (err) {
    // KVバインディング未設定など、想定外の問題が起きても、ページ全体を壊さないよう空の結果を返す。
    // 原因調査のため、エラーメッセージのみ（秘密情報は含まない）Cloudflare Functionsログへ残す。
    // eslint-disable-next-line no-console
    console.error("social-feed: unexpected error", err instanceof Error ? err.message : "unknown_error");
    body = { posts: [], updatedAt: null, stale: true, status: DEFAULT_STATUS, fetchFailed: true };
  }

  return new Response(JSON.stringify(body), {
    status: 200,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      // Meta APIへのアクセス回数を抑えつつ、新しい投稿を約5分以内に反映するため、
      // s-maxage=300（Cloudflareエッジで5分）とする。stale-while-revalidateで
      // 同期が遅延・失敗していても古いキャッシュの提供を継続する。
      "Cache-Control": "public, max-age=60, s-maxage=300, stale-while-revalidate=86400",
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
