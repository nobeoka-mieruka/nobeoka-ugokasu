// =============================================================
// 後援会入会申込み機能に関する設定です。
//
// 【Googleフォームの用意ができたら】
// 1. scripts/後援会入会申込_Googleフォーム自動作成.gs をGoogle Apps Scriptで実行し、
//    入会申込用のGoogleフォームを作成してください。
// 2. 実行後にログへ出力される「フォームの回答用URL」を membershipFormUrl に、
//    「フォームの埋め込み用URL」を membershipFormEmbedUrl に設定してください。
// 3. 値を設定するまでは、/supporters/join/ ページに
//    「入会申込フォームは現在準備中です。公開までしばらくお待ちください。」と表示され、
//    存在しないフォームへのリンクや空のiframeが表示されることはありません。
// =============================================================

export const supportersConfig = {
  /**
   * 入会申込用Googleフォームの回答用URL（例: https://docs.google.com/forms/d/e/xxxx/viewform）。
   * 未設定（空文字）の間は「準備中」の案内が表示されます。
   */
  membershipFormUrl:
    "https://docs.google.com/forms/d/e/1FAIpQLSfE2OO5UrUhIEXqqhHRuz9DbO2WUOsrRyLbJ3MzTXF1drjr4A/viewform",

  /**
   * 入会申込用Googleフォームの埋め込み表示用URL（末尾に ?embedded=true を付けたもの）。
   * 未設定（空文字）の間はページ内へのフォーム埋め込みは行われません。
   */
  membershipFormEmbedUrl:
    "https://docs.google.com/forms/d/e/1FAIpQLSfE2OO5UrUhIEXqqhHRuz9DbO2WUOsrRyLbJ3MzTXF1drjr4A/viewform?embedded=true",

  /**
   * 後援会規約PDFの公開パス（public/ 配下からの相対パス）。
   * 実体ファイル：public/pdfs/kouenkaikiyaku.pdf
   */
  rulesPdfUrl: "/pdfs/kouenkaikiyaku.pdf",
} as const;

export type SupportersConfig = typeof supportersConfig;
