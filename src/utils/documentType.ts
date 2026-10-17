// 資料のURLから種類（Google Drive・Docs・Sheets・PDF・Webリンク）を判定します。
// サーバー側（server/documents.ts）と、登録画面の目安表示（src/scripts/staff/documentForm.ts）の両方で使います。
// 判定できない場合は「その他」。URLの中身を取得することはありません（URLの文字列だけで判定）。

import type { DocumentType } from "../types/documents";

export function detectDocumentType(href: string): DocumentType {
  let url: URL;
  try {
    url = new URL(href.trim());
  } catch {
    return "other";
  }
  if (url.protocol !== "https:") return "other";
  const host = url.hostname.toLowerCase();
  const path = url.pathname.toLowerCase();
  if (host === "docs.google.com") {
    if (path.startsWith("/document/")) return "google_docs";
    if (path.startsWith("/spreadsheets/")) return "google_sheets";
    return "other";
  }
  if (host === "drive.google.com") return "google_drive";
  if (path.endsWith(".pdf")) return "pdf";
  return "web";
}
