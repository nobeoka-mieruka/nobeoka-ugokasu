// 「最新のお知らせ」の型です。
// お知らせは執行部ポータル（/staff/news/）から登録し、Cloudflare D1（news_items テーブル）に保存します。
// トップページと /news/ は、配信時に D1 の内容を読み込んで表示します（functions/index.ts・functions/news/index.ts）。

/** カテゴリー（D1に保存する内部値） */
export const NEWS_CATEGORIES = ["activity_report", "dialogue", "event", "notice", "site_update"] as const;
export type NewsCategoryKey = (typeof NEWS_CATEGORIES)[number];

/** 新規登録で選べるカテゴリー（「サイト更新」は既存データのためだけに残し、新規には使わない） */
export const SELECTABLE_NEWS_CATEGORIES: readonly NewsCategoryKey[] = ["activity_report", "dialogue", "event", "notice"];

/** カテゴリーの表示名 */
export const NEWS_CATEGORY_LABELS: Record<NewsCategoryKey, string> = {
  activity_report: "活動報告",
  dialogue: "意見交換会",
  event: "イベント",
  notice: "お知らせ",
  site_update: "サイト更新",
};

/**
 * 画面に表示するお知らせ1件分（D1のお知らせと、記事ページなどファイルで管理しているお知らせの共通形）。
 * 公開してよい項目だけを持つ。
 */
export interface NewsDisplayItem {
  /**
   * 重複表示を防ぐためのキー。D1のお知らせは "d1:<id>"。
   * ファイル由来のお知らせは "article:<slug>"（記事）・"news:<id>"（src/data/news.ts）・"social:<投稿ID>"（SNS投稿の昇格）。
   */
  key: string;
  /** 掲載日（YYYY-MM-DD） */
  date: string;
  title: string;
  summary: string;
  /** カテゴリーの表示名（例：「活動報告」） */
  category: string;
  /** リンク先（サイト内のパス、または https:// のURL）。無い場合は空文字 */
  href: string;
  /** 表示順（小さいほど先。同じ値の間は掲載日の新しい順） */
  displayOrder: number;
}

/** 執行部ポータルで扱うお知らせ（管理用の項目を含む） */
export interface NewsItemRecord {
  id: number;
  /** 既存データの移行元・他機能からの登録元（重複防止用）。管理画面で作成したものは null */
  sourceKey: string | null;
  publishedOn: string;
  category: NewsCategoryKey;
  title: string;
  summary: string;
  linkUrl: string;
  isPublished: boolean;
  displayOrder: number;
  createdAt: number;
  updatedAt: number;
  createdBy: string;
  updatedBy: string;
}
