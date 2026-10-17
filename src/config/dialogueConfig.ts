// =============================================================
// 意見交換会ページ（/dialogue/）に関する設定です。
//
// 【GoogleフォームのURLを変更する場合】
// GOOGLE_FORM_URL だけを書き換えてください。
// 埋め込み用URL（?embedded=true）は自動的に組み立てられます。
//
// 開催日程は src/data/dialogueEvents.ts で管理しています。
// =============================================================

/** 意見交換会参加申込フォームの回答用URL（「フォームを別画面で開く」ボタンのリンク先） */
const GOOGLE_FORM_URL =
  "https://docs.google.com/forms/d/e/1FAIpQLScmY6pGcRApiGwAgG2o0PaWqspnjv2cgqwg_tpaEKNkD5tLOQ/viewform";

/** ページ内のiframeに埋め込む表示用URL */
const GOOGLE_FORM_EMBED_URL = `${GOOGLE_FORM_URL}?embedded=true`;

export const dialogueConfig = {
  formUrl: GOOGLE_FORM_URL,
  formEmbedUrl: GOOGLE_FORM_EMBED_URL,
  /** iframeのtitle属性（スクリーンリーダー向けの名称） */
  formTitle: "福富千恵と延岡を動かす会 意見交換会参加申込フォーム",
} as const;

export type DialogueConfig = typeof dialogueConfig;
