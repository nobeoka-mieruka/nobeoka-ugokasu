// Google Analytics 4（gtag.js）まわりの共通ロジックです。
// 実際のタグ読み込み・自動クリック計測の初期化は src/scripts/analyticsBootstrap.ts が行い、
// このモジュールはページ内のどこからでも安全に呼び出せる小さな関数だけを提供します。
//
// 方針：
// - 本番ホスト（siteConfig.siteUrl）以外（localhost・Cloudflare Pagesのプレビューデプロイ等）
//   では絶対に計測しない
// - 訪問者がアクセス解析を無効にしている場合は送信しない
// - window.gtag が読み込まれていない場合もエラーにしない
// - 送信するイベントパラメータは許可リストに含まれるものだけ（個人情報の混入を防ぐ）

import { siteConfig } from "../config/siteConfig";
import { seoConfig } from "../config/seoConfig";

const CONSENT_STORAGE_KEY = "analytics-consent";
export type AnalyticsConsent = "granted" | "denied";

function getProductionHostname(): string {
  try {
    return new URL(siteConfig.siteUrl).hostname;
  } catch {
    return "";
  }
}

/** 現在のホストが本番ドメインかどうか（localhost・Cloudflare Pagesのプレビューは含まれない） */
export function isProductionHost(): boolean {
  if (typeof window === "undefined") return false;
  const productionHostname = getProductionHostname();
  return productionHostname !== "" && window.location.hostname === productionHostname;
}

/** 保存されているアクセス解析の同意状態。未設定の場合は"granted"（既定で計測する）扱い */
export function getAnalyticsConsent(): AnalyticsConsent {
  if (typeof window === "undefined") return "granted";
  try {
    return window.localStorage.getItem(CONSENT_STORAGE_KEY) === "denied" ? "denied" : "granted";
  } catch {
    return "granted";
  }
}

/** アクセス解析の同意状態を保存し、GA4公式の無効化フラグ（ga-disable-<ID>）も同期する */
export function setAnalyticsConsent(value: AnalyticsConsent): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(CONSENT_STORAGE_KEY, value);
  } catch {
    // プライベートモード等でlocalStorageが使えない場合は何もしない（サイト利用は継続できる）
  }
  if (seoConfig.ga4Id) {
    window[`ga-disable-${seoConfig.ga4Id}`] = value === "denied";
  }
}

/** 実際にGA4へ送信してよい状態かどうか（本番ホスト・同意あり・gtag読み込み済みのすべてを満たす） */
export function isAnalyticsEnabled(): boolean {
  return (
    typeof window !== "undefined" &&
    Boolean(seoConfig.ga4Id) &&
    isProductionHost() &&
    getAnalyticsConsent() !== "denied" &&
    typeof window.gtag === "function"
  );
}

/** イベントパラメータとして送信してよいキーのみを通す許可リスト（個人情報の誤送信を防ぐ） */
const ALLOWED_PARAM_KEYS = new Set(["page_path", "link_url", "link_text", "content_type", "activity_source"]);

type EventParams = Record<string, string | number | boolean>;

function sanitizeParams(params?: EventParams): EventParams | undefined {
  if (!params) return undefined;
  const safe: EventParams = {};
  for (const [key, value] of Object.entries(params)) {
    if (ALLOWED_PARAM_KEYS.has(key)) safe[key] = value;
  }
  return Object.keys(safe).length > 0 ? safe : undefined;
}

/** GA4イベントを送信する。計測が無効な状況では常に安全に何もしない */
export function trackEvent(eventName: string, params?: EventParams): void {
  if (!isAnalyticsEnabled()) return;
  window.gtag?.("event", eventName, sanitizeParams(params));
}

/** 外部リンククリック計測の簡易ラッパー（link_url / link_text のみを付与する） */
export function trackOutboundClick(eventName: string, linkUrl: string, linkText?: string): void {
  trackEvent(eventName, {
    link_url: linkUrl,
    ...(linkText ? { link_text: linkText.slice(0, 100) } : {}),
  });
}
