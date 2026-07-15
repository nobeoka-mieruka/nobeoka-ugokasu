import { defineConfig } from "astro/config";
import tailwind from "@astrojs/tailwind";
import sitemap from "@astrojs/sitemap";
import { siteConfig } from "./src/config/siteConfig.ts";

// サイトの公開URLはsrc/config/siteConfig.tsで一元管理しています。
// 独自ドメインへ移行する際はsiteConfig.tsのsiteUrlだけを変更してください。
export default defineConfig({
  site: siteConfig.siteUrl,
  output: "static",
  trailingSlash: "ignore",
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
        !page.includes("/404"),
    }),
  ],
  image: {
    remotePatterns: [],
  },
});
