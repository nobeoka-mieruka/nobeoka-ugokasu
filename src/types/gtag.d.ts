// window.gtag / window.dataLayer のブラウザ側グローバル型定義です。
// gtag.js は本番環境かつ計測に同意している場合のみ動的に読み込まれるため
//（src/scripts/analyticsBootstrap.ts参照）、常に存在するとは限りません。
// 呼び出し側は必ず typeof window.gtag === "function" を確認してから使用してください。

export {};

declare global {
  interface Window {
    dataLayer?: unknown[];
    gtag?: (...args: unknown[]) => void;
    /**
     * src/scripts/analyticsBootstrap.ts が設定する、共通イベント送信関数への参照。
     * is:inline スクリプト（ESモジュールのimportが使えない箇所）から
     * src/utils/analytics.ts の trackEvent() を呼び出すための橋渡し。
     */
    trackEvent?: (eventName: string, params?: Record<string, string | number | boolean>) => void;
    [key: `ga-disable-${string}`]: boolean | undefined;
  }
}
