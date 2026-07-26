import type { SocialMediaType, SocialPost } from "../src/types/social";
import type { FacebookPostRaw, InstagramMediaRaw } from "./metaClient";

const TITLE_MAX_LENGTH = 40;
const CONTROL_CHAR_MAX_CODE = 0x1f;
// 1行がハッシュタグ（と空白）だけで構成されているかの判定用
const HASHTAG_ONLY_LINE = /^(#\S+)(\s+#\S+)*$/u;
const HASHTAG_PATTERN = /#[^\s#]+/gu;

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

function isHashtagOnlyLine(line: string): boolean {
  return HASHTAG_ONLY_LINE.test(line);
}

/**
 * ハッシュタグしか無い行から、タイトルとして表示できる文言を作る。
 * ハッシュタグの文字列そのものを使うだけで、投稿内容にない事実は補わない。
 */
function titleFromHashtags(line: string): string | null {
  const tags = (line.match(HASHTAG_PATTERN) ?? []).map((tag) => tag.slice(1)).filter(Boolean);
  if (tags.length === 0) return null;
  const joined = tags.slice(0, 2).join("・");
  const title = `${joined}について`;
  return title.length <= TITLE_MAX_LENGTH ? title : `${joined.slice(0, TITLE_MAX_LENGTH - 1)}…`;
}

/**
 * 投稿本文からタイトルを作る。先頭行がハッシュタグだけの場合（例：
 * 「#就労継続支援B型事業所延岡」）は、本文中に文章がある行があればそちらを優先し、
 * 投稿全体がハッシュタグだけの場合はハッシュタグの文言から読める形のタイトルを作る。
 */
function makeTitle(body: string, fallback: string): string {
  const clean = sanitizeText(body);
  if (clean.length === 0) return fallback;

  const lines = clean
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  if (lines.length === 0) return fallback;

  const sourceLine = lines.find((line) => !isHashtagOnlyLine(line)) ?? lines[0];

  if (isHashtagOnlyLine(sourceLine)) {
    return titleFromHashtags(sourceLine) ?? fallback;
  }

  if (sourceLine.length <= TITLE_MAX_LENGTH) return sourceLine;
  return `${sourceLine.slice(0, TITLE_MAX_LENGTH)}...`;
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

  // CAROUSEL_ALBUM自体にはmedia_urlが返らないため、先頭メディア（children[0]）を
  // カード表示用の画像・サムネイルとして使う。
  let imageUrl: string | null = null;
  let thumbnailUrl: string | null = null;

  if (mediaType === "CAROUSEL_ALBUM") {
    const firstChild = raw.children?.data?.[0];
    const childIsVideo = (firstChild?.media_type ?? "").toUpperCase() === "VIDEO";
    if (childIsVideo) {
      thumbnailUrl = firstChild?.media_url ?? null;
    } else {
      imageUrl = firstChild?.media_url ?? null;
    }
  } else if (isVideoLike) {
    thumbnailUrl = raw.thumbnail_url ?? null;
  } else {
    imageUrl = raw.media_url ?? null;
  }

  return {
    id: raw.id,
    platform: "instagram",
    publishedAt: raw.timestamp ?? new Date().toISOString(),
    title: makeTitle(caption, "Instagram活動報告"),
    description: caption,
    permalink: raw.permalink,
    imageUrl,
    thumbnailUrl,
    mediaType,
    sourceName: "Instagram",
  };
}
