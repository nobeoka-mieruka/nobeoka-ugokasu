// /vision と /issues/[slug] の両方から使う、提言ごとの「関連する活動報告」抽出ロジック。
// 公式サイトの活動報告コレクション（relatedIssues）に加えて、実際の活動報告の中心である
// Facebook投稿スナップショット・手動登録SNS投稿もキーワードで絞り込む（vision.astro参照）。
import type { CollectionEntry } from "astro:content";
import type { VisionProposal } from "../data/vision";
import type { BuildSocialPost } from "../types/social";
import type { SnsActivity } from "../data/snsActivities";
import { textMatchesKeywords } from "./visionRelated";

export type RelatedActivityItem = { title: string; href: string; date: Date; external: boolean };

export const MAX_RELATED_ACTIVITIES = 3;

export function buildRelatedActivities(
  proposal: Pick<VisionProposal, "slug" | "relatedKeywords">,
  data: {
    activities: CollectionEntry<"activities">[];
    buildSocialPosts: BuildSocialPost[];
    snsActivities: SnsActivity[];
  },
): RelatedActivityItem[] {
  const website: RelatedActivityItem[] = data.activities
    .filter((a) => a.data.relatedIssues.includes(proposal.slug))
    .map((a) => ({ title: a.data.title, href: `/activities/${a.slug}/`, date: a.data.date, external: false }));

  const social: RelatedActivityItem[] = data.buildSocialPosts
    .filter((p) => textMatchesKeywords(`${p.title} ${p.description}`, proposal.relatedKeywords))
    .map((p) => ({ title: p.title, href: p.permalink, date: new Date(p.publishedAt), external: true }));

  const sns: RelatedActivityItem[] = data.snsActivities
    .filter((s) => textMatchesKeywords(`${s.title} ${s.description}`, proposal.relatedKeywords))
    .map((s) => ({ title: s.title, href: s.postUrl, date: new Date(s.date), external: true }));

  return [...website, ...social, ...sns]
    .sort((a, b) => b.date.getTime() - a.date.getTime())
    .slice(0, MAX_RELATED_ACTIVITIES);
}
