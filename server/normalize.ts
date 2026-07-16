import type { SocialMediaType, SocialPost } from "../src/types/social";
import type { FacebookPostRaw, InstagramMediaRaw } from "./metaClient";

const TITLE_MAX_LENGTH = 40;
const CONTROL_CHAR_MAX_CODE = 0x1f;

/**
 * 投稿本文の制御文字（改行・タブを除く）だけを取り除く。表示側は常にtextContentで
 * 挿入するためHTMLとして実行されることはないが、保存段階でも軽く無害化しておく。
 */
function sanitizeText(text: string): string {
  let result = "";
  for (const ch of text) {
    const code = ch.codePointAt(0) ?? 0;
    const isUnwantedControl = code <= CONTROL_CHAR_MAX_CODE && ch !== "\n" && ch !== "\t";
    if (!isUnwantedControl) result += ch;
  }
  return result.trim();
}

function makeTitle(body: string, fallback: string): string {
  const clean = sanitizeText(body);
  if (clean.length === 0) return fallback;
  const firstLine = clean.split(/\r?\n/)[0];
  if (firstLine.length <= TITLE_MAX_LENGTH) return firstLine;
  return `${firstLine.slice(0, TITLE_MAX_LENGTH)}...`;
}

export function normalizeFacebookPost(raw: FacebookPostRaw): SocialPost | null {
  if (!raw.id || !raw.permalink_url) return null;

  const message = sanitizeText(raw.message ?? "");
  const attachment = raw.attachments?.data?.[0];

  let mediaType: SocialMediaType = "STATUS";
  let imageUrl: string | null = null;
  let thumbnailUrl: string | null = null;

  if (attachment?.media_type === "video") {
    mediaType = "VIDEO";
    thumbnailUrl = attachment.media?.image?.src ?? raw.full_picture ?? null;
  } else if (attachment?.media_type === "album") {
    mediaType = "CAROUSEL_ALBUM";
    imageUrl = raw.full_picture ?? attachment.media?.image?.src ?? null;
  } else if (attachment?.media_type === "photo" || raw.full_picture) {
    mediaType = "IMAGE";
    imageUrl = raw.full_picture ?? attachment?.media?.image?.src ?? null;
  } else if (attachment?.url) {
    mediaType = "LINK";
    imageUrl = attachment.media?.image?.src ?? null;
  }

  return {
    id: raw.id,
    platform: "facebook",
    publishedAt: raw.created_time ?? new Date().toISOString(),
    title: makeTitle(message, "Facebook活動報告"),
    description: message,
    permalink: raw.permalink_url,
    imageUrl,
    thumbnailUrl,
    mediaType,
    sourceName: "Facebook",
  };
}

export function normalizeInstagramMedia(raw: InstagramMediaRaw): SocialPost | null {
  if (!raw.id || !raw.permalink) return null;

  const caption = sanitizeText(raw.caption ?? "");
  const isReel = raw.media_product_type === "REELS";
  const rawType = (raw.media_type ?? "IMAGE").toUpperCase();
  const mediaType: SocialMediaType = isReel
    ? "REELS"
    : rawType === "VIDEO"
      ? "VIDEO"
      : rawType === "CAROUSEL_ALBUM"
        ? "CAROUSEL_ALBUM"
        : "IMAGE";

  const isVideoLike = mediaType === "VIDEO" || mediaType === "REELS";

  return {
    id: raw.id,
    platform: "instagram",
    publishedAt: raw.timestamp ?? new Date().toISOString(),
    title: makeTitle(caption, "Instagram活動報告"),
    description: caption,
    permalink: raw.permalink,
    imageUrl: isVideoLike ? null : (raw.media_url ?? null),
    thumbnailUrl: isVideoLike ? (raw.thumbnail_url ?? null) : null,
    mediaType,
    sourceName: "Instagram",
  };
}
