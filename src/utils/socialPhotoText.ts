// 活動写真ページ（/photos）でSNS投稿本文から短い説明文・alt文言を作るための、
// サーバー側（src/data/activityPhotos.ts）とブラウザ実行時
//（src/scripts/activityPhotoGrid.ts）の両方から使う共通ロジックです。
// astro:content 等のサーバー専用APIには依存しないため、クライアント側スクリプトからも
// そのままインポートできます。

import type { SocialPlatformKey } from "../config/socialPlatformMeta";

const URL_PATTERN = /https?:\/\/\S+/gu;
const HTML_TAG_PATTERN = /<[^>]*>/gu;
const DESCRIPTION_MAX_LENGTH = 100;
const ALT_SNIPPET_MAX_LENGTH = 40;

const DEFAULT_SOCIAL_DESCRIPTION: Record<SocialPlatformKey, string> = {
  facebook: "Facebookに掲載した活動写真",
  instagram: "Instagramに掲載した活動写真",
  threads: "Threadsに掲載した活動写真",
};

const DEFAULT_SOCIAL_ALT: Record<SocialPlatformKey, string> = {
  facebook: "Facebookに掲載した福富千恵と延岡を動かす会の活動写真",
  instagram: "Instagramに掲載した福富千恵と延岡を動かす会の活動写真",
  threads: "Threadsに掲載した福富千恵と延岡を動かす会の活動写真",
};

/** SNS投稿本文からHTML・URL・余分な空白を取り除いた、素のテキストを作る */
export function cleanSocialText(raw: string): string {
  return raw
    .replace(HTML_TAG_PATTERN, "")
    .replace(URL_PATTERN, "")
    .replace(/\s+/gu, " ")
    .trim();
}

/** カードに表示する短い説明文（60〜100文字程度）。本文が空の場合は投稿元ごとの既定文言を使う */
export function buildSocialPhotoDescription(rawText: string, platform: SocialPlatformKey): string {
  const cleaned = cleanSocialText(rawText);
  if (cleaned.length === 0) return DEFAULT_SOCIAL_DESCRIPTION[platform];
  return cleaned.length > DESCRIPTION_MAX_LENGTH ? `${cleaned.slice(0, DESCRIPTION_MAX_LENGTH)}…` : cleaned;
}

/** 画像のalt文言。本文から内容が読み取れる場合はそこから、読み取れない場合は投稿元ごとの既定文言を使う */
export function buildSocialPhotoAlt(rawText: string, platform: SocialPlatformKey): string {
  const cleaned = cleanSocialText(rawText);
  if (cleaned.length === 0) return DEFAULT_SOCIAL_ALT[platform];
  const snippet = cleaned.length > ALT_SNIPPET_MAX_LENGTH ? `${cleaned.slice(0, ALT_SNIPPET_MAX_LENGTH)}...` : cleaned;
  return `${snippet}の活動写真`;
}
