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

interface FacebookPostsResponse {
  data?: FacebookPostRaw[];
  error?: { message?: string; type?: string; code?: number };
}

export async function fetchFacebookPosts(params: {
  pageId: string;
  accessToken: string;
  apiVersion?: string;
  limit: number;
}): Promise<FacebookPostRaw[]> {
  const version = apiVersion(params.apiVersion);
  const fields = "id,message,created_time,permalink_url,full_picture,attachments{media_type,type,url,media}";
  const url =
    `https://graph.facebook.com/${version}/${encodeURIComponent(params.pageId)}/posts` +
    `?fields=${encodeURIComponent(fields)}&limit=${params.limit}` +
    `&access_token=${encodeURIComponent(params.accessToken)}`;

  const res = await fetch(url);
  const body = (await res.json()) as FacebookPostsResponse;

  if (!res.ok || body.error) {
    throw new Error(`facebook_api_error:${body.error?.type ?? res.status}`);
  }

  return body.data ?? [];
}

// ---- Instagramメディア ----

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
}

interface InstagramMediaResponse {
  data?: InstagramMediaRaw[];
  error?: { message?: string; type?: string; code?: number };
}

export async function fetchInstagramMedia(params: {
  businessAccountId: string;
  accessToken: string;
  apiVersion?: string;
  limit: number;
}): Promise<InstagramMediaRaw[]> {
  const version = apiVersion(params.apiVersion);
  const fields = "id,caption,media_type,media_product_type,media_url,thumbnail_url,permalink,timestamp,username";
  const url =
    `https://graph.facebook.com/${version}/${encodeURIComponent(params.businessAccountId)}/media` +
    `?fields=${encodeURIComponent(fields)}&limit=${params.limit}` +
    `&access_token=${encodeURIComponent(params.accessToken)}`;

  const res = await fetch(url);
  const body = (await res.json()) as InstagramMediaResponse;

  if (!res.ok || body.error) {
    throw new Error(`instagram_api_error:${body.error?.type ?? res.status}`);
  }

  // media_product_type が "STORY" のものは24時間で消えるストーリーズのため対象外にする
  return (body.data ?? []).filter((item) => item.media_product_type !== "STORY");
}
