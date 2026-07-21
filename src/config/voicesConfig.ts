// =============================================================
// 「みんなの声」（ブロードリスニング）機能に関する設定です。
// =============================================================

export const voicesConfig = {
  /**
   * 意見受付用Googleフォームの URL。
   * 空欄にすると「現在、意見受付フォームを準備しています。」という表示に自動的に戻ります。
   */
  googleFormUrl: "https://docs.google.com/forms/d/e/1FAIpQLSezz5jWvNZUNtpEJaVVHjrLcoEPPYPfGgb4DpbZjZCfr4BY1Q/viewform",

  /**
   * 座談会・意見交換会の開催希望を受け付けるフォームのURL。
   * 空欄の間は「声の集め方」の当該カードはクリックできない情報カードとして表示されます。
   * 専用フォームを用意でき次第、ここへURLを設定してください。
   */
  roundtableFormUrl: "",

  /**
   * AIによる自動分析・自動送信の有効化フラグ。
   *
   * 初期公開時は必ず false としてください。
   * 個人情報を含む原文をAIへ自動送信する機能は実装していません。
   *
   * 運用手順（12-6章）：
   * 1. 回答を収集する
   * 2. 個人情報を削除する
   * 3. 事務局が内容を確認する
   * 4. 必要に応じてAIで分類・要約する（事務局の手動作業として）
   * 5. 事務局が元の文章と照合する
   * 6. 確認後の内容だけを src/content/voice-reports/ へ公開する
   *
   * 禁止事項：個人情報のAI送信、無確認での結果公開、批判的意見の恣意的な削除、
   * 少数意見の自動除外、AIによる提言採否の決定、投稿者の政治的傾向の推測、
   * 支持者・非支持者への分類、選挙勧誘対象者リストへの利用。
   */
  aiAnalysisEnabled: false,

  /** 声の収集方法（12-1章） */
  collectionMethods: [
    "Googleフォーム",
    "意見交換会",
    "紙のアンケート",
    "地域での聞き取り",
    "メール",
    "LINE",
    "活動会場",
    "その他",
  ] as const,

  /** 対応状況ラベル（12-5章） */
  responseStatusLabels: [
    "受け付けました",
    "内容を整理しています",
    "詳しく調査しています",
    "意見交換を予定しています",
    "提言への反映を検討しています",
    "提言に反映しました",
    "情報提供を行いました",
    "現時点では対応が困難です",
    "対応を終了しました",
  ] as const,

  /** テーマの募集状態ラベル（12-2章） */
  themeStatusLabels: ["準備中", "募集中", "集計中", "結果公開中", "募集終了"] as const,
} as const;

export type VoicesConfig = typeof voicesConfig;
export type ResponseStatusLabel = (typeof voicesConfig.responseStatusLabels)[number];
export type ThemeStatusLabel = (typeof voicesConfig.themeStatusLabels)[number];
