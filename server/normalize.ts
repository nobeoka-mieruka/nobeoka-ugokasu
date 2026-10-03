import type { SocialMediaType, SocialPost } from "../src/types/social";
import type { FacebookPostRaw, InstagramMediaRaw } from "./metaClient";
import type { ThreadsPostRaw } from "./threadsClient";

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

/**
 * カルーセル（複数メディア）投稿の表紙画像を決める。先頭が動画の場合はmedia_url（動画ファイル）
 * ではなくthumbnail_urlを使い、サムネイルが無ければ後続の画像メディアを探す。
 */
function carouselCover(children: { media_type?: string; media_url?: string; thumbnail_url?: string }[] | undefined): {
  imageUrl: string | null;
  thumbnailUrl: string | null;
} {
  for (const child of children ?? []) {
    const isVideo = (child.media_type ?? "").toUpperCase() === "VIDEO";
    if (!isVideo && child.media_url) return { imageUrl: child.media_url, thumbnailUrl: null };
    if (isVideo && child.thumbnail_url) return { imageUrl: null, thumbnailUrl: child.thumbnail_url };
  }
  return { imageUrl: null, thumbnailUrl: null };
}

export function normalizeFacebookPost(raw: FacebookPostRaw): SocialPost | null {
  if (!raw.id || !raw.permalink_url) return null;

  const message = sanitizeText(raw.message ?? "");
  const attachment = raw.attachments?.data?.[0];

  let mediaType: SocialMediaType = "STATUS";
  let imageUrl: string | null = null;
  let thumbnailUrl: string | null = null;
  let mediaCount = 0;

  if (attachment?.media_type === "video") {
    mediaType = "VIDEO";
    thumbnailUrl = attachment.media?.image?.src ?? raw.full_picture ?? null;
  } else if (attachment?.media_type === "album") {
    mediaType = "CAROUSEL_ALBUM";
    imageUrl = raw.full_picture ?? attachment.media?.image?.src ?? null;
    mediaCount = attachment.subattachments?.data?.length ?? 0;
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
    ...(mediaCount > 1 ? { mediaCount } : {}),
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
    ({ imageUrl, thumbnailUrl } = carouselCover(raw.children?.data));
  } else if (isVideoLike) {
    thumbnailUrl = raw.thumbnail_url ?? null;
  } else {
    imageUrl = raw.media_url ?? null;
  }
  const mediaCount = mediaType === "CAROUSEL_ALBUM" ? (raw.children?.data?.length ?? 0) : 0;

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
    ...(mediaCount > 1 ? { mediaCount } : {}),
    sourceName: "Instagram",
  };
}

export function normalizeThreadsPost(raw: ThreadsPostRaw): SocialPost | null {
  if (!raw.id || !raw.permalink) return null;

  const text = sanitizeText(raw.text ?? "");
  const rawType = (raw.media_type ?? "TEXT_POST").toUpperCase();

  let mediaType: SocialMediaType = "STATUS";
  let imageUrl: string | null = null;
  let thumbnailUrl: string | null = null;

  if (rawType === "CAROUSEL_ALBUM") {
    mediaType = "CAROUSEL_ALBUM";
    // CAROUSEL_ALBUM自体にはmedia_urlが返らないため、先頭メディア（children[0]）を
    // カード表示用の画像・サムネイルとして使う（normalizeInstagramMediaと同じ方針）。
    ({ imageUrl, thumbnailUrl } = carouselCover(raw.children?.data));
  } else if (rawType === "VIDEO") {
    mediaType = "VIDEO";
    // media_urlは動画ファイル（mp4）のため、画像としては使わない
    thumbnailUrl = raw.thumbnail_url ?? null;
  } else if (rawType === "IMAGE") {
    mediaType = "IMAGE";
    imageUrl = raw.media_url ?? null;
  }
  // "TEXT_POST" | "AUDIO" | "REPOST_FACADE" 等、画像を持たない投稿種別は mediaType: "STATUS" のまま

  return {
    id: raw.id,
    platform: "threads",
    publishedAt: raw.timestamp ?? new Date().toISOString(),
    title: makeTitle(text, "Threads活動報告"),
    description: text,
    permalink: raw.permalink,
    imageUrl,
    thumbnailUrl,
    mediaType,
    ...(mediaType === "CAROUSEL_ALBUM" && (raw.children?.data?.length ?? 0) > 1 ? { mediaCount: raw.children!.data!.length } : {}),
    sourceName: "Threads",
  };
}
