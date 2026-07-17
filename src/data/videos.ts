// 動画（YouTube）情報を一元管理するファイルです。
//
// 【動画を追加する方法】
// 下記の videos 配列に、オブジェクトを1件追加するだけで
// /videos ページと（featured: true の場合）トップページに反映されます。
//
// 例：
// {
//   id: "video-001",
//   youtubeId: "YouTube動画のID（URLの v= の後ろの部分）",
//   title: "動画タイトル",
//   description: "動画の説明",
//   publishedAt: "2026-07-17",
//   category: "activity",
//   featured: true,
// }
//
// 【将来YouTube Data APIに切り替える場合】
// このファイルが返す配列の形（VideoItem[]）はそのままに、
// videos の中身をAPIから取得したデータで置き換えられるよう、
// 一覧・カード側は videos 配列の形にのみ依存する設計にしています。
// 詳しくはREADME「動画（YouTube）を追加する方法」を参照してください。

export type VideoCategory = "message" | "activity" | "policy" | "shorts" | "other";

export interface VideoItem {
  id: string;
  youtubeId: string;
  title: string;
  description: string;
  publishedAt?: string;
  category: VideoCategory;
  featured?: boolean;
}

export const videoCategoryLabels: Record<VideoCategory, string> = {
  message: "メッセージ",
  activity: "活動報告",
  policy: "政策",
  shorts: "ショート動画",
  other: "その他",
};

export const videos: VideoItem[] = [];
