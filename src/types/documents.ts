// 資料（執行部ポータル /staff/documents/ で管理、D1: staff_documents テーブル）の型です。
// すべて執行部内部用で、公開ページには一切表示しません。
// 現在はGoogle Drive などクラウド上の資料へのリンクを整理する方式です。将来ファイル本体を保存する場合は
// Cloudflare R2 等に保存し、storage_key 列を追加して url の代わりに使う形で拡張できます。

/**
 * カテゴリー（D1に保存する内部値）。追加する場合はこの配列とラベルに1行足すだけです
 *（D1側には値の制約を設けていないため、テーブルの変更は不要）。
 */
export const DOCUMENT_CATEGORIES = ["supporters", "meeting", "event", "dialogue", "pr", "election", "other"] as const;
export type DocumentCategory = (typeof DOCUMENT_CATEGORIES)[number];

export const DOCUMENT_CATEGORY_LABELS: Record<DocumentCategory, string> = {
  supporters: "後援会資料",
  meeting: "会議資料",
  event: "イベント",
  dialogue: "意見交換会",
  pr: "広報",
  election: "選挙関連",
  other: "その他",
};

/** 資料の種類（URLから自動判定。判定できない場合は「その他」） */
export const DOCUMENT_TYPES = ["google_drive", "google_docs", "google_sheets", "pdf", "web", "other"] as const;
export type DocumentType = (typeof DOCUMENT_TYPES)[number];

export const DOCUMENT_TYPE_LABELS: Record<DocumentType, string> = {
  google_drive: "Google Drive",
  google_docs: "Google ドキュメント",
  google_sheets: "Google スプレッドシート",
  pdf: "PDF",
  web: "Webリンク",
  other: "その他",
};

export interface DocumentRecord {
  id: number;
  title: string;
  category: DocumentCategory;
  description: string;
  url: string;
  documentType: DocumentType;
  pinned: boolean;
  displayOrder: number;
  createdAt: number;
  updatedAt: number;
  createdBy: string;
  updatedBy: string;
}
