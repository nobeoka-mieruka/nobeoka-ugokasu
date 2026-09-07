// =============================================================
// 「重要なSNS投稿」をお知らせへ昇格させるための設定ファイルです。
//
// -------------------------------------------------------------
// 【この仕組みの考え方】
// SNS投稿は、これまでどおり全件が「最新の活動報告」へ自動表示されます
//（src/data/activities.ts）。この動きは一切変更していません。
//
// そのうえで、特に広くお知らせしたい投稿だけを、このファイルへ投稿IDを
// 1行追加することで「お知らせ」にも表示できます。
//   ・全投稿が自動でお知らせになることはありません（お知らせが埋もれないため）
//   ・SNS側の自動取得処理（scripts/sync-social-posts.mjs・/api/social-feed）は
//     一切変更していません。この設定は取得結果を読むだけです
//   ・投稿が取得できない状態でも、ここでエラーになることはありません
//
// -------------------------------------------------------------
// 【お知らせへ昇格させる手順】
// 1. 対象の投稿IDを調べる
//    src/data/socialPostsSnapshot.json を開き、対象投稿の "id" をコピーします。
//    （例: "1282455044943687_122118395127398900"）
// 2. 下の socialNewsPromotions 配列へ1件追加する
// 3. npm run build が通ることを確認する
//
// 記入例：
// {
//   postId: "1282455044943687_122118395127398900",
//   featured: true,
//   category: "活動報告",
//   title: "新たに看板を設置しました",   // 省略可（省略時は投稿のタイトルを使用）
// },
//
// -------------------------------------------------------------
// 【注意】
// ・投稿本文をそのまま載せるため、事実と異なる要約を書かないでください。
// ・すでに src/data/news.ts へ同じ内容を手動登録している場合は、
//   リンク先が同じであれば自動的に重複が取り除かれます。
// =============================================================

import socialPostsSnapshot from "./socialPostsSnapshot.json";
import type { BuildSocialPost } from "../types/social";
import type { NewsCategory, UnifiedNews } from "./news";

export interface SocialNewsPromotion {
  /** 対象のSNS投稿ID（src/data/socialPostsSnapshot.json の "id"） */
  postId: string;
  /** true の場合のみ、お知らせとして表示します */
  featured: boolean;
  /** お知らせ上の分類（省略時は「活動報告」） */
  category?: NewsCategory;
  /** お知らせ上の見出し（省略時は投稿から生成されたタイトルを使用） */
  title?: string;
  /** お知らせ上の要約（省略時は投稿本文の先頭から自動生成） */
  summary?: string;
}

/**
 * お知らせへ昇格させるSNS投稿の一覧。
 *
 * 現在は空です。2026年8月の看板設置の投稿は、内容を確認したうえで
 * src/data/news.ts へお知らせとして登録済みのため、ここでは重複させていません。
 * 今後、SNS投稿をそのままお知らせにしたい場合にご利用ください。
 */
export const socialNewsPromotions: SocialNewsPromotion[] = [];

const SUMMARY_MAX_LENGTH = 120;

/** 投稿本文から、お知らせカード用の短い要約を作る（本文にない内容は補わない） */
function buildSummary(description: string): string {
  const normalized = description
    .split("\n")
    .map((line) => line.trim())
    // ハッシュタグだけの行は要約に含めない
    .filter((line) => line.length > 0 && !/^(?:[#＃]\S+\s*)+$/u.test(line))
    .join(" ");

  if (normalized.length <= SUMMARY_MAX_LENGTH) return normalized;
  return `${normalized.slice(0, SUMMARY_MAX_LENGTH - 1)}…`;
}

/**
 * 昇格対象として設定されたSNS投稿を、お知らせ表示用の形へ変換して返す。
 * 投稿が見つからない・スナップショットが空の場合は、単に0件を返す
 *（SNSが取得できない状態でもお知らせページを壊さないため）。
 */
export function promotedSocialNews(now: number = Date.now()): UnifiedNews[] {
  const featured = socialNewsPromotions.filter((promotion) => promotion.featured);
  if (featured.length === 0) return [];

  const posts = socialPostsSnapshot.posts as unknown as BuildSocialPost[];

  return featured
    .map((promotion): UnifiedNews | null => {
      const post = posts.find((candidate) => candidate.id === promotion.postId);
      if (!post) return null;

      const date = new Date(post.publishedAt);
      if (Number.isNaN(date.getTime()) || date.getTime() > now) return null;

      return {
        id: `social-${post.id}`,
        date,
        title: promotion.title ?? post.title,
        summary: promotion.summary ?? buildSummary(post.description),
        category: promotion.category ?? "活動報告",
        href: post.permalink,
        external: true,
      };
    })
    .filter((entry): entry is UnifiedNews => entry !== null);
}
