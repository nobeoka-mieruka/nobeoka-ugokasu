// 活動写真ページ（/photos）のデータ集約です。
// 写真を個別に手動管理するのではなく、次の2種類の実在データから自動的に集約します。
//   1. 公開済み活動報告（src/content/activities/）の mainImage / images
//   2. SNS投稿（手動登録: src/data/snsActivities.ts、ビルド時同期スナップショット:
//      src/data/socialPostsSnapshot.json）のうち、画像が確認できる投稿
// いずれも活動報告一覧・トップページと共通のデータ取得口（src/data/activities.ts の
// getUnifiedActivities）を経由するため、下書き・非公開・公開日が未来の記事や投稿は
// 同じ基準で除外されます。SNS投稿の画像URLは、既存のactivityImage.tsのロジック
// （ローカルミラー優先、無ければ /api/social-image 経由の同一オリジンプロキシ）を
// そのまま再利用し、Meta/Threadsの画像を直接ホットリンクしません。

import type { ImageMetadata } from "astro";
import { getUnifiedActivities } from "./activities";
import { resolveActivityImage } from "../utils/activityImage";
import { buildSocialPhotoAlt, buildSocialPhotoDescription } from "../utils/socialPhotoText";
import type { SocialPlatformKey } from "../config/socialPlatformMeta";

export type ActivityPhotoSource = "website" | SocialPlatformKey;

export type ActivityPhoto =
  | {
      kind: "website";
      source: "website";
      src: ImageMetadata;
      alt: string;
      title: string;
      date: Date;
      category: string;
      href: string;
    }
  | {
      kind: "social";
      source: SocialPlatformKey;
      imageUrl: string;
      alt: string;
      description: string;
      date: Date;
      permalink: string;
      id: string;
    };

function buildWebsiteAlt(alt: string | undefined, activityTitle: string): string {
  const trimmed = alt?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : `${activityTitle}の活動写真`;
}

/**
 * 公開済み活動報告・SNS投稿から写真を集約する。
 * - 活動報告・投稿の絞り込み（下書き・非公開・未来日付の除外）と並び順は getUnifiedActivities と共通
 * - 活動報告の画像は、ビルド後の解決済みパス（ImageMetadata.src）を基準に重複除外
 * - SNS投稿は permalink → 投稿ID → 画像URL の順で重複除外（手動登録とビルド時同期に同じ投稿が
 *   重複登録されていても1枚だけ表示する）
 * - 画像URLが確認できない投稿（テキストのみの投稿、動画のみでサムネイルも無い投稿）は含めない
 */
export async function getActivityPhotos(): Promise<ActivityPhoto[]> {
  const unified = await getUnifiedActivities();

  const photos: ActivityPhoto[] = [];
  const seenWebsiteSrc = new Set<string>();
  const seenSocialKey = new Set<string>();

  for (const activity of unified) {
    if (activity.kind === "website") {
      const { data, slug } = activity.entry;
      const candidates = [...(data.mainImage ? [data.mainImage] : []), ...data.images];

      for (const image of candidates) {
        const key = image.src.src;
        if (seenWebsiteSrc.has(key)) continue;
        seenWebsiteSrc.add(key);

        photos.push({
          kind: "website",
          source: "website",
          src: image.src,
          alt: buildWebsiteAlt(image.alt, data.title),
          title: data.title,
          date: activity.date,
          category: data.category,
          href: `/activities/${slug}/`,
        });
      }
      continue;
    }

    if (activity.kind === "sns") {
      const entry = activity.entry;
      if (!entry.image?.src) continue;

      const key = entry.postUrl || entry.id || entry.image.src;
      if (seenSocialKey.has(key)) continue;
      seenSocialKey.add(key);

      photos.push({
        kind: "social",
        source: entry.platform,
        imageUrl: entry.image.src,
        alt: entry.image.alt?.trim() || buildSocialPhotoAlt(entry.description, entry.platform),
        description: buildSocialPhotoDescription(entry.description, entry.platform),
        date: activity.date,
        permalink: entry.postUrl,
        id: entry.id,
      });
      continue;
    }

    // activity.kind === "social"（ビルド時同期スナップショットのSNS投稿）
    const post = activity.entry;
    const resolvedImage = resolveActivityImage(post);
    if (!resolvedImage) continue; // 画像URLが無い投稿（テキストのみ・サムネイル無しの動画等）は除外

    const key = post.permalink || post.id || resolvedImage.src;
    if (seenSocialKey.has(key)) continue;
    seenSocialKey.add(key);

    photos.push({
      kind: "social",
      source: post.platform,
      imageUrl: resolvedImage.src,
      alt: buildSocialPhotoAlt(post.description, post.platform),
      description: buildSocialPhotoDescription(post.description, post.platform),
      date: activity.date,
      permalink: post.permalink,
      id: post.id,
    });
  }

  return photos.sort((a, b) => b.date.getTime() - a.date.getTime());
}

const SOURCE_ORDER: ActivityPhotoSource[] = ["website", "facebook", "instagram", "threads"];

/** 写真一覧に実際に登場する投稿元（存在するものだけ、既存の活動報告絞り込みと同じ表示順） */
export function getPresentSources(photos: ActivityPhoto[]): ActivityPhotoSource[] {
  const present = new Set(photos.map((photo) => photo.source));
  return SOURCE_ORDER.filter((source) => present.has(source));
}
