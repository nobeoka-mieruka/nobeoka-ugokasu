import { defineConfig } from "astro/config";
import tailwind from "@astrojs/tailwind";
import sitemap from "@astrojs/sitemap";
import { siteConfig } from "./src/config/siteConfig.ts";
import { videos } from "./src/data/videos.ts";

// 掲載できる動画が1本も無い間は /videos/ をサイトマップから外す（ページ・URLは残す）。
// src/data/videos.ts へ動画を追加すれば、自動的にサイトマップへ戻る（7章）。
const hasPublishedVideos = videos.length > 0;

// サイトの公開URLはsrc/config/siteConfig.tsで一元管理しています。
// 独自ドメインへ移行する際はsiteConfig.tsのsiteUrlだけを変更してください。
export default defineConfig({
  site: siteConfig.siteUrl,
  output: "static",
  // 正規URLの方針（末尾スラッシュあり）。Cloudflare Pagesが末尾スラッシュなしのURLを
  // 自動的に308リダイレクトするため、開発サーバーの挙動も本番に合わせて統一する。
  trailingSlash: "always",
  integrations: [
    tailwind({
      applyBaseStyles: false,
    }),
    sitemap({
      // noindexページ（下書き中のissuesページ、フォーム準備中の/voices/submit、404）はサイトマップから除外します。
      // issues/* を本公開する際は、対応するissues/*.mdのdraftをfalseに変更した上でここも見直してください。
      filter: (page) =>
        !page.includes("/voices/submit") &&
        !page.includes("/issues/") &&
        !page.includes("/404") &&
        (hasPublishedVideos || !page.includes("/videos")),
    }),
  ],
  image: {
    remotePatterns: [],
  },
});
