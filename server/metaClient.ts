// Meta Graph APIから、Facebookページの投稿とInstagramプロアカウントのメディアを
// 取得するための最小限のクライアントです。個人プロフィールの取得やスクレイピングは
// 一切行わず、Meta公式のGraph APIエンドポイントのみを呼び出します。

const DEFAULT_API_VERSION = "v21.0";

function apiVersion(version: string | undefined): string {
  return version && version.trim() !== "" ? version : DEFAULT_API_VERSION;
}

// ---- Facebookページ投稿 ----

interface FacebookAttachmentMedia {
  image?: { src?: string };
}

interface FacebookAttachment {
  media_type?: string; // "photo" | "video" | "album" | "link" など
  type?: string;
  url?: string;
  media?: FacebookAttachmentMedia;
}

export interface FacebookPostRaw {
  id: string;
  message?: string;
  created_time?: string;
  permalink_url?: string;
  full_picture?: string;
  attachments?: {
    data?: FacebookAttachment[];
  };
}

/**
 * Graph APIがエラー時に返すerrorオブジェクト。
 * 注意：messageフィールドには、エラーの種類によってはアクセストークンの値そのものが
 * Meta側から含まれて返ってくることがある（例：「Malformed access token <トークン文字列>」）。
 * ログへ残す前に必ず redactSecrets() を通すこと。
 */
interface GraphApiError {
  message?: string;
  type?: string;
  code?: number;
  error_subcode?: number;
}

interface FacebookPostsResponse {
  data?: FacebookPostRaw[];
  error?: GraphApiError;
}

/**
 * Meta Graph APIのアクセストークンは20文字以上の英数字・アンダースコア・ハイフンの
 * 連続した文字列であるため、その形状に一致する部分をすべて伏せ字にする。
 * エラーメッセージにトークンの値がそのまま含まれるケースがあるための対策。
 */
function redactSecrets(text: string): string {
  return text.replace(/[A-Za-z0-9_-]{20,}/g, "[REDACTED]");
}

/** ログ出力用に、原因特定に必要な範囲だけを安全な文字列へまとめる（トークン等は伏せ字化する） */
function describeGraphApiError(httpStatus: number, error: GraphApiError | undefined): string {
  const detail = {
    httpStatus,
    type: error?.type ?? null,
    code: error?.code ?? null,
    subcode: error?.error_subcode ?? null,
    message: error?.message ? redactSecrets(error.message.slice(0, 300)) : null,
  };
  return JSON.stringify(detail);
}

export async function fetchFacebookPosts(params: {
  pageId: string;
  accessToken: string;
  apiVersion?: string;
  limit: number;
}): Promise<FacebookPostRaw[]> {
  const version = apiVersion(params.apiVersion);
  const fields = "id,message,created_time,permalink_url,full_picture,attachments{media_type,type,url,media}";
  // published_posts エッジを使用し、Facebookページ自身が公開した投稿だけを取得する
  // （訪問者がページへ投稿した内容は含まれない）。
  const url =
    `https://graph.facebook.com/${version}/${encodeURIComponent(params.pageId)}/published_posts` +
    `?fields=${encodeURIComponent(fields)}&limit=${params.limit}` +
    `&access_token=${encodeURIComponent(params.accessToken)}`;

  const res = await fetch(url);
  const body = (await res.json()) as FacebookPostsResponse;

  if (!res.ok || body.error) {
    throw new Error(`facebook_api_error:${describeGraphApiError(res.status, body.error)}`);
  }

  return body.data ?? [];
}

// ---- Instagramメディア ----

interface InstagramChildMedia {
  media_url?: string;
  media_type?: string; // "IMAGE" | "VIDEO"
}

export interface InstagramMediaRaw {
  id: string;
  caption?: string;
  media_type?: string; // "IMAGE" | "VIDEO" | "CAROUSEL_ALBUM"
  media_product_type?: string; // "FEED" | "REELS" | "STORY" など
  media_url?: string;
  thumbnail_url?: string;
  permalink?: string;
  timestamp?: string;
  username?: string;
  /** CAROUSEL_ALBUM の場合のみ返る、各メディアの一覧（先頭要素をカード表示に使う） */
  children?: {
    data?: InstagramChildMedia[];
  };
}

interface InstagramMediaResponse {
  data?: InstagramMediaRaw[];
  error?: GraphApiError;
}

export async function fetchInstagramMedia(params: {
  userId: string;
  accessToken: string;
  apiVersion?: string;
  limit: number;
}): Promise<InstagramMediaRaw[]> {
  const version = apiVersion(params.apiVersion);
  const fields =
    "id,caption,media_type,media_product_type,media_url,thumbnail_url,permalink,timestamp,username,children{media_url,media_type}";
  const url =
    `https://graph.facebook.com/${version}/${encodeURIComponent(params.userId)}/media` +
    `?fields=${encodeURIComponent(fields)}&limit=${params.limit}` +
    `&access_token=${encodeURIComponent(params.accessToken)}`;

  const res = await fetch(url);
  const body = (await res.json()) as InstagramMediaResponse;

  if (!res.ok || body.error) {
    throw new Error(`instagram_api_error:${describeGraphApiError(res.status, body.error)}`);
  }

  // media_product_type が "STORY" のものは24時間で消えるストーリーズのため対象外にする
  return (body.data ?? []).filter((item) => item.media_product_type !== "STORY");
}
