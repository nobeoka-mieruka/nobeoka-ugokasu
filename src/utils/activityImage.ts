// SNS投稿（Facebook/Instagram）カードに表示する画像を、Astroのビルド時（.astroフロントマター）と
// ブラウザ実行時（src/scripts/socialPostCard.ts）の両方から共通のロジックで決定するための
// ユーティリティです。normalizeActivityPost()相当の役割を持ちます。
//
// 表示する画像は、定期同期がサイト側に保存した画像（localImage、/api/social-image?k=...）だけ。
// SNS側の画像URL（imageUrl / thumbnailUrl）は時間が経つと無効になる署名付きURLのため、
// 表示には一切使わない（保存済みの画像が無い投稿は「画像なし」のカードになる）。
//
// 表示方法（cover/contain）は画像の縦横比から自動で決める（縦長の写真で人物の顔が
// 切れないようにするため）。投稿ID単位で src/config/activityImageOverrides.ts から
// 上書きもできる（チラシ・書影などの文字入り画像をcoverで切り取らないため）。

import type { SocialPost } from "../types/social";
import { getActivityImageOverride } from "../config/activityImageOverrides";

export interface ResolvedActivityImage {
  src: string;
  /** localImageから取得できた場合のみ既知（レイアウトずれ防止のwidth/height指定に使用） */
  width?: number;
  height?: number;
  /** "cover"＝通常の活動写真向け（既定）。"contain"＝チラシ・書影等、画像全体を見せたい場合 */
  fit: "cover" | "contain";
  /** object-position に渡すCSS値。省略時は"center" */
  position: string;
}

type ImageSourcePost = Pick<SocialPost, "id" | "localImage">;

/** サイト内で配信している画像パス（/ で始まり、// ではない）かどうか */
function isSiteImagePath(src: unknown): src is string {
  return typeof src === "string" && src.startsWith("/") && !src.startsWith("//");
}

/**
 * 縦横比から、16:9の画像枠への収め方を決める。
 * ・横長（4:3より横長）… 枠いっぱいに表示（cover、中央）
 * ・正方形に近い          … cover。上下が切れるため、顔が写りやすい上寄りを基準にする
 * ・縦長                  … 全体を見せる（contain）。人物の頭や足元が切れないようにする
 * 寸法が分からない場合は従来どおり cover・中央。
 */
function fitForAspect(width?: number, height?: number): { fit: "cover" | "contain"; position: string } {
  if (!width || !height) return { fit: "cover", position: "center" };
  const ratio = width / height;
  if (ratio >= 1.3) return { fit: "cover", position: "center" };
  if (ratio >= 0.9) return { fit: "cover", position: "center 30%" };
  return { fit: "contain", position: "center" };
}

/**
 * 投稿から表示すべき画像を1つ決定する。表示できる画像が無い・無効な場合はnullを返し、
 * 呼び出し側はコンパクトなフォールバック表示に切り替える。
 */
export function resolveActivityImage(post: ImageSourcePost): ResolvedActivityImage | null {
  const local = post.localImage;
  if (!local || !isSiteImagePath(local.src)) return null;

  const auto = fitForAspect(local.width, local.height);
  const override = getActivityImageOverride(post.id);
  return {
    src: local.src,
    width: local.width,
    height: local.height,
    fit: override?.imageFit ?? auto.fit,
    position: override?.imagePosition ?? auto.position,
  };
}

/**
 * SNS投稿カードの表示内容（画像・見出し・本文）を表す短い文字列。
 * ビルド時に出力したカードと、ページ表示後に /api/social-feed から届いた最新の内容を比べ、
 * 画像の差し替え・本文の編集があった場合だけカードを入れ替えるために使う。
 */
export function socialCardSignature(post: Pick<SocialPost, "title" | "description" | "localImage" | "mediaCount">): string {
  const material = [post.localImage?.src ?? "", post.title, post.description, post.mediaCount ?? 1].join("");
  let hash = 0x811c9dc5;
  for (let i = 0; i < material.length; i++) {
    hash ^= material.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16);
}

const LEADING_HASHTAG_RUN = /^(?:[#＃]\S+\s*)+/;

/** タイトルから、自然な代替テキスト（alt属性）を作る（例:「就労継続支援B型事業所訪問の活動写真」） */
function buildTitleBasedAlt(title: string): string {
  const withoutLeadingHashtags = title.replace(LEADING_HASHTAG_RUN, "").trim();
  const base = withoutLeadingHashtags.length > 0 ? withoutLeadingHashtags : title.trim();
  const truncated = base.length > 40 ? `${base.slice(0, 40)}...` : base;
  return truncated.length > 0 ? `${truncated}の活動写真` : "活動報告の写真";
}

/**
 * 画像のalt属性を決定する。src/config/activityImageOverrides.ts に投稿ID単位の
 * imageAlt指定があればそれを優先し、無ければ投稿タイトルから自動生成する。
 */
export function buildActivityImageAlt(post: Pick<SocialPost, "id" | "title">): string {
  const override = getActivityImageOverride(post.id);
  if (override?.imageAlt) return override.imageAlt;
  return buildTitleBasedAlt(post.title);
}
