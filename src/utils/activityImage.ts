// SNS投稿（Facebook/Instagram）カードに表示する画像を、Astroのビルド時（.astroフロントマター）と
// ブラウザ実行時（src/scripts/socialPostCard.ts）の両方から共通のロジックで決定するための
// ユーティリティです。normalizeActivityPost()相当の役割を持ちます。
//
// 優先順位：
//   1. ビルド時同期（scripts/sync-facebook-posts.mjs）でローカルへ保存済みの画像（localImage）
//   2. imageUrl / thumbnailUrl を、Facebook CDNへ直接リンクさせず /api/social-image 経由で表示
//      （functions/api/social-image.ts が許可ホストのみを検証・取得・キャッシュする）
//
// null/空文字/undefined/http(s)以外のURLは、無効な画像として扱いここでフィルタする。

import type { SocialPost } from "../types/social";

export interface ResolvedActivityImage {
  src: string;
  /** localImageから取得できた場合のみ既知（レイアウトずれ防止のwidth/height指定に使用） */
  width?: number;
  height?: number;
}

type ImageSourcePost = Pick<SocialPost, "imageUrl" | "thumbnailUrl" | "localImage">;

/** 画像候補として有効な絶対URL（http/https）かどうかを判定する */
function isPlausibleRemoteImageUrl(url: string | null | undefined): url is string {
  if (typeof url !== "string") return false;
  const trimmed = url.trim();
  if (trimmed.length === 0) return false;
  try {
    const parsed = new URL(trimmed);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

/** functions/api/social-image.ts 向けの、同一オリジン経由プロキシURLを組み立てる */
export function buildSocialImageProxyUrl(remoteUrl: string): string {
  return `/api/social-image?u=${encodeURIComponent(remoteUrl)}`;
}

/**
 * 投稿から表示すべき画像を1つ決定する。表示できる画像が無い・無効な場合はnullを返し、
 * 呼び出し側はコンパクトなフォールバック表示に切り替える。
 */
export function resolveActivityImage(post: ImageSourcePost): ResolvedActivityImage | null {
  const local = post.localImage;
  if (local && typeof local.src === "string" && local.src.trim().length > 0) {
    return { src: local.src, width: local.width, height: local.height };
  }

  const remoteCandidate = post.imageUrl ?? post.thumbnailUrl;
  if (isPlausibleRemoteImageUrl(remoteCandidate)) {
    return { src: buildSocialImageProxyUrl(remoteCandidate) };
  }

  return null;
}

const LEADING_HASHTAG_RUN = /^(?:[#＃]\S+\s*)+/;

/** 投稿タイトルから、自然な代替テキスト（alt属性）を作る（例:「就労継続支援B型事業所訪問の活動写真」） */
export function buildActivityImageAlt(title: string): string {
  const withoutLeadingHashtags = title.replace(LEADING_HASHTAG_RUN, "").trim();
  const base = withoutLeadingHashtags.length > 0 ? withoutLeadingHashtags : title.trim();
  const truncated = base.length > 40 ? `${base.slice(0, 40)}...` : base;
  return truncated.length > 0 ? `${truncated}の活動写真` : "活動報告の写真";
}
