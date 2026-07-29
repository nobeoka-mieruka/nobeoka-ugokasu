// 活動写真ページ（/photos）のデータ集約です。
// 写真を個別に手動管理するのではなく、公開済みの活動報告（src/content/activities/）に
// 登録されている mainImage / images を自動的に集約して表示します（活動報告の記事データと
// 写真データを二重管理しないため）。掲載する活動報告の絞り込み・並び順は、活動報告一覧・
// トップページと共通のデータ取得口（src/data/activities.ts の getUnifiedActivities）に
// 揃えています（下書き・非公開・公開日が未来の記事は同じ基準で除外されます）。

import type { ImageMetadata } from "astro";
import { getUnifiedActivities, type UnifiedActivity } from "./activities";

export interface ActivityPhoto {
  src: ImageMetadata;
  alt: string;
  activityTitle: string;
  activityDate: Date;
  activitySlug: string;
  category: string;
}

type WebsiteActivity = Extract<UnifiedActivity, { kind: "website" }>;

function buildAlt(alt: string | undefined, activityTitle: string): string {
  const trimmed = alt?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : `${activityTitle}の活動写真`;
}

/**
 * 公開済み活動報告から mainImage と images を集約する。
 * - 活動報告の並び順（新しい順、下書き・非公開・未来日付の除外）は getUnifiedActivities と共通
 * - 同じ画像（ビルド後の解決済みパスが同一）が複数登録されていた場合は、先に見つかったものだけ残す
 */
export async function getActivityPhotos(): Promise<ActivityPhoto[]> {
  const unified = await getUnifiedActivities();
  const websiteActivities = unified.filter((activity): activity is WebsiteActivity => activity.kind === "website");

  const photos: ActivityPhoto[] = [];
  const seenSrc = new Set<string>();

  for (const activity of websiteActivities) {
    const { data, slug } = activity.entry;
    const candidates = [...(data.mainImage ? [data.mainImage] : []), ...data.images];

    for (const image of candidates) {
      const key = image.src.src;
      if (seenSrc.has(key)) continue;
      seenSrc.add(key);

      photos.push({
        src: image.src,
        alt: buildAlt(image.alt, data.title),
        activityTitle: data.title,
        activityDate: data.date,
        activitySlug: slug,
        category: data.category,
      });
    }
  }

  return photos;
}

/** 写真一覧に実際に登場するカテゴリー（存在するものだけ、登場順） */
export function getPresentCategories(photos: ActivityPhoto[]): string[] {
  const categories: string[] = [];
  for (const photo of photos) {
    if (!categories.includes(photo.category)) categories.push(photo.category);
  }
  return categories;
}
