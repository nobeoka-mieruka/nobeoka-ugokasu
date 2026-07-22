// =============================================================
// SEO・アクセス解析に関する設定を一元管理するファイルです。
// 値は環境変数（.env）から読み込みます。空欄の場合は該当機能を出力しません。
// .env の作り方は README.md を参照してください。
// =============================================================

export const seoConfig = {
  /** Google Search Console 所有権確認コード（未設定なら出力しない） */
  gscVerification: import.meta.env.PUBLIC_GSC_VERIFICATION ?? "f69UUuOF1LW2fOCniLvDV6wtdDU8gvuPFnNadGXfkZQ",

  /** Bing Webmaster Tools 所有権確認コード（未設定なら出力しない） */
  bingVerification: import.meta.env.PUBLIC_BING_VERIFICATION ?? "",

  /** Google Analytics 4 測定ID（未設定なら計測タグを読み込まない） */
  ga4Id: import.meta.env.PUBLIC_GA4_ID ?? "",

  /** Cloudflare Web Analytics トークン（未設定なら計測タグを読み込まない） */
  cfAnalyticsToken: import.meta.env.PUBLIC_CF_ANALYTICS_TOKEN ?? "",

  /** Twitter/X カード種別 */
  twitterCard: "summary_large_image" as const,

  /** 共通OGP画像の幅・高さ（Facebook/LINE等でのプレビュー表示に使用） */
  ogpImageWidth: 1200,
  ogpImageHeight: 630,
} as const;

export type SeoConfig = typeof seoConfig;
