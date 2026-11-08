import rss from "@astrojs/rss";
import type { APIRoute } from "astro";
import { getCollection } from "astro:content";
import { siteConfig } from "../config/siteConfig";

export const GET: APIRoute = async (context) => {
  // 並び順はトップページ・/news/ と同じ（掲載日の新しい順、同じ日はファイル名の昇順）
  const news = (await getCollection("news", ({ data }) => data.published)).sort(
    (a, b) => b.data.date.getTime() - a.data.date.getTime() || (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0),
  );

  return rss({
    title: `${siteConfig.siteName}｜お知らせ`,
    description: "福富千恵と延岡を動かす会からのお知らせフィードです。",
    site: context.site ?? siteConfig.siteUrl,
    items: news.map((entry) => ({
      title: entry.data.title,
      description: entry.data.summary,
      pubDate: entry.data.date,
      link: `/news/${entry.slug}/`,
      categories: [entry.data.category],
    })),
    customData: `<language>ja</language>`,
  });
};
