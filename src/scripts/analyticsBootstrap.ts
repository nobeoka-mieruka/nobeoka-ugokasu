// GA4（gtag.js）の初期化と、共通のクリック計測をまとめて行うブートストラップです。
// src/layouts/BaseLayout.astro（SeoHead.astro経由）から、全ページ共通で1回だけ読み込みます。
//
// このスクリプトの責務：
//   1. 本番ホスト（siteConfig.siteUrl）かつ計測に同意している場合だけ、gtag.jsを動的に読み込む
//      （localhost・Cloudflare Pagesのプレビューデプロイでは、スクリプトタグ自体を挿入しない）
//   2. 主要な外部リンク・フォームリンクのクリックを、共通のイベント名で自動計測する
//   3. is:inlineスクリプト（ESモジュールが使えない箇所）から呼べるよう、
//      window.trackEvent へ橋渡しする

import { seoConfig } from "../config/seoConfig";
import { socialConfig } from "../config/socialConfig";
import { voicesConfig } from "../config/voicesConfig";
import { supportersConfig } from "../config/supporters";
import { getAnalyticsConsent, isProductionHost, trackEvent, trackOutboundClick } from "../utils/analytics";

function loadGtag(measurementId: string): void {
  window.dataLayer = window.dataLayer || [];
  function gtag(...args: unknown[]) {
    window.dataLayer?.push(args);
  }
  window.gtag = gtag;
  gtag("js", new Date());
  // 個人情報保護のため、Google広告向けの信号連携・広告パーソナライズ連携は無効化する
  gtag("config", measurementId, {
    allow_google_signals: false,
    allow_ad_personalization_signals: false,
  });

  const script = document.createElement("script");
  script.async = true;
  script.src = `https://www.googletagmanager.com/gtag/js?id=${measurementId}`;
  document.head.appendChild(script);
}

function initAnalytics(): void {
  const measurementId = seoConfig.ga4Id;
  if (!measurementId) return;

  if (getAnalyticsConsent() === "denied") {
    // 既にgtag.jsが何らかの経路で読み込まれてしまった場合の保険として、公式の無効化フラグも立てる
    window[`ga-disable-${measurementId}`] = true;
    return;
  }

  if (!isProductionHost()) return; // localhost・プレビューデプロイでは計測タグ自体を読み込まない

  loadGtag(measurementId);
}

initAnalytics();

// is:inline スクリプト（市役所案内診断など）からも呼び出せるようにする
window.trackEvent = trackEvent;

// ---- 主要なリンククリックの自動計測 ----
// ページごとに計測コードを書かず、ここでイベント委譲により一括対応する。

function setupAutoClickTracking(): void {
  document.addEventListener(
    "click",
    (event) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      const anchor = target.closest("a[href]");
      if (!(anchor instanceof HTMLAnchorElement)) return;

      const href = anchor.href;
      const linkText = anchor.textContent?.trim().slice(0, 100);

      // 明示的にdata-track属性が付いているリンク（例：活動報告の続きを読む）を優先する
      const trackedAncestor = target.closest<HTMLElement>("[data-track]");
      if (trackedAncestor?.dataset.track) {
        trackEvent(trackedAncestor.dataset.track, { link_url: href });
        return;
      }

      if (socialConfig.facebookPageUrl && href.startsWith(socialConfig.facebookPageUrl)) {
        trackOutboundClick("facebook_click", href, linkText);
        return;
      }
      if (socialConfig.instagramProfileUrl && href.startsWith(socialConfig.instagramProfileUrl)) {
        trackOutboundClick("instagram_click", href, linkText);
        return;
      }
      if (voicesConfig.googleFormUrl && href.startsWith(voicesConfig.googleFormUrl)) {
        trackOutboundClick("voice_form_click", href, linkText);
        return;
      }
      if (supportersConfig.membershipFormUrl && href.startsWith(supportersConfig.membershipFormUrl)) {
        trackOutboundClick("supporter_join_click", href, linkText);
        return;
      }
      if (supportersConfig.rulesPdfUrl && href.includes(supportersConfig.rulesPdfUrl)) {
        trackOutboundClick("supporter_rules_open", href, linkText);
        return;
      }
      if (href.startsWith("mailto:")) {
        trackEvent("contact_click", { link_url: href });
      }
    },
    true,
  );
}

setupAutoClickTracking();
