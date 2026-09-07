// 活動報告データの唯一の集約窓口です。
// 次の4つのデータ源をまとめて、公開日の新しい順に並び替えて返します。
//
//   1. 公式サイト記事（Content Collections: src/content/activities/）
//   2. サイト側で管理する活動報告（src/data/activityEntries.ts）← 追加はここが一番かんたんです
//   3. 手動登録のSNS投稿（src/data/snsActivities.ts、従来からの登録分）
//   4. ビルド時同期のSNS投稿スナップショット（src/data/socialPostsSnapshot.json）
//
// 1〜3はSNSのAPI取得に一切依存しないため、SNSが停止していても必ず表示されます
// （15章の段階的フォールバックの土台になります）。
//
// トップページ（src/pages/index.astro）と活動報告一覧ページ（src/pages/activities/index.astro）は
// 必ずこの getUnifiedActivities() だけを呼び出してください。ページごとに個別の配列・並び替え・
// フィルタ処理を持たせると、トップページと一覧ページで表示内容がずれる原因になります。

import { getCollection, type CollectionEntry } from "astro:content";
import { getSortedSnsActivities, type SnsActivity, type SnsPlatform } from "./snsActivities";
import { getSortedActivityEntries, type ActivityEntry } from "./activityEntries";
import socialPostsSnapshot from "./socialPostsSnapshot.json";
import type { BuildSocialPost } from "../types/social";

export type UnifiedActivity =
  | { kind: "website"; date: Date; entry: CollectionEntry<"activities"> }
  | { kind: "manual"; date: Date; entry: ActivityEntry }
  | { kind: "sns"; date: Date; entry: SnsActivity }
  | { kind: "social"; date: Date; entry: BuildSocialPost };

/**
 * 活動報告一覧・トップページ共通の取得口。
 * - 下書き（published: false）は除外する
 * - 公開日が未来の記事は除外する（日付は必ず Date に変換して比較する）
 * - 文字列の日付も含め、常に new Date(...).getTime() で新しい順に並び替える
 */
export async function getUnifiedActivities(): Promise<UnifiedActivity[]> {
  const now = Date.now();

  const websiteActivities = await getCollection(
    "activities",
    ({ data }) => data.published && data.date.getTime() <= now,
  );
  const manualEntries = getSortedActivityEntries(now);
  const snsActivities = getSortedSnsActivities();
  const buildSocialPosts = (socialPostsSnapshot.posts as unknown as BuildSocialPost[]).filter(
    (post) => new Date(post.publishedAt).getTime() <= now,
  );

  // 同じ投稿URLがサイト側（activityEntries.ts）とSNS自動取得の両方にある場合は、
  // サイト側の登録を優先して重複表示を防ぐ。
  const manualUrls = new Set(manualEntries.map((entry) => entry.url).filter((url): url is string => Boolean(url)));

  const unified: UnifiedActivity[] = [
    ...websiteActivities.map((entry): UnifiedActivity => ({ kind: "website", date: entry.data.date, entry })),
    ...manualEntries.map((entry): UnifiedActivity => ({ kind: "manual", date: new Date(entry.date), entry })),
    ...snsActivities
      .filter((entry) => !manualUrls.has(entry.postUrl))
      .map((entry): UnifiedActivity => ({ kind: "sns", date: new Date(entry.date), entry })),
    ...buildSocialPosts
      .filter((post) => !manualUrls.has(post.permalink))
      .map((entry): UnifiedActivity => ({ kind: "social", date: new Date(entry.publishedAt), entry })),
  ];

  return unified.sort((a, b) => b.date.getTime() - a.date.getTime());
}

/** 公式サイト（SNS投稿によらない）活動報告が1件でもあるか判定する */
export function hasWebsiteActivity(activities: UnifiedActivity[]): boolean {
  return activities.some(
    (activity) =>
      activity.kind === "website" || (activity.kind === "manual" && activity.entry.platform === "website"),
  );
}

/** 指定したプラットフォーム（クロス投稿分を含む）の活動報告が1件でもあるか判定する */
export function hasPlatformActivity(activities: UnifiedActivity[], platform: SnsPlatform): boolean {
  return activities.some((activity) => {
    if (activity.kind === "manual") {
      return activity.entry.platform === platform;
    }
    if (activity.kind === "sns") {
      return activity.entry.platform === platform || activity.entry.crossPostPlatform === platform;
    }
    if (activity.kind === "social") {
      return activity.entry.platform === platform;
    }
    return false;
  });
}
