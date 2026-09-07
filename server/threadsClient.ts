// 公式Threads API（graph.threads.net）から、Threadsプロアカウントの公開投稿を取得する
// ための最小限のクライアントです。個人プロフィールのスクレイピングは一切行わず、
// Meta公式のThreads APIエンドポイントのみを呼び出します。
//
// 注意：Threads APIはMeta Graph API（graph.facebook.com、server/metaClient.ts）とは
// 別ホスト・別の認可フロー（Threads API単独のアクセストークン）のため、
// META_ACCESS_TOKEN を使い回すことはできません（THREADS_ACCESS_TOKENを別途使用）。

import { describeGraphApiError, type GraphApiError } from "./metaClient";

const DEFAULT_THREADS_API_VERSION = "v1.0";

function apiVersion(version: string | undefined): string {
  return version && version.trim() !== "" ? version : DEFAULT_THREADS_API_VERSION;
}

interface ThreadsChildMedia {
  media_url?: string;
  media_type?: string; // "IMAGE" | "VIDEO"
}

export interface ThreadsPostRaw {
  id: string;
  media_type?: string; // "TEXT_POST" | "IMAGE" | "VIDEO" | "CAROUSEL_ALBUM" | "AUDIO" | "REPOST_FACADE"
  text?: string;
  permalink?: string;
  timestamp?: string;
  media_url?: string;
  thumbnail_url?: string;
  /** CAROUSEL_ALBUM の場合のみ返る、各メディアの一覧（先頭要素をカード表示に使う） */
  children?: {
    data?: ThreadsChildMedia[];
  };
}

interface ThreadsPostsResponse {
  data?: ThreadsPostRaw[];
  error?: GraphApiError;
}

export async function fetchThreadsPosts(params: {
  userId: string;
  accessToken: string;
  apiVersion?: string;
  limit: number;
}): Promise<ThreadsPostRaw[]> {
  const version = apiVersion(params.apiVersion);
  const fields = "id,media_type,text,permalink,timestamp,media_url,thumbnail_url,children{media_type,media_url}";
  // threads エッジは、対象アカウント自身が公開したThreads投稿のみを返す。
  const url =
    `https://graph.threads.net/${version}/${encodeURIComponent(params.userId)}/threads` +
    `?fields=${encodeURIComponent(fields)}&limit=${params.limit}` +
    `&access_token=${encodeURIComponent(params.accessToken)}`;

  const res = await fetch(url);
  const body = (await res.json()) as ThreadsPostsResponse;

  if (!res.ok || body.error) {
    throw new Error(`threads_api_error:${describeGraphApiError(res.status, body.error)}`);
  }

  return body.data ?? [];
}
