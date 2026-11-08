// /rss.xml（お知らせのRSS）を、配信時にD1（執行部ポータル /staff/news/）のお知らせを含めた内容で作り直す部品です。
// 使い方は functions/rss.xml.ts。
//
// ・中身はトップページ・/news/ と同じ（server/newsPublic.ts と同じく、D1のお知らせと /news/file-items.json を mergeNews でまとめる）
// ・ヘッダー（Content-Type等）は静的な /rss.xml（ビルド時に src/pages/rss.xml.ts で作成）のものをそのまま使う
// ・D1や記事一覧を読めない場合は、静的な /rss.xml をそのまま返す（記事ファイルだけのRSS）

// siteConfig.ts はビルド時用（process.env を読む）のため、Functionsでは読み込まない
import { SITE_URL } from "../src/config/siteUrl";
import type { NewsDisplayItem } from "../src/types/news";
import { todayInJapan } from "../src/utils/dialogueEvents";
import { mergeNews } from "../src/utils/newsCards";
import { listPublicNews } from "./newsItems";
import type { PublicPageEnv } from "./newsPublic";

/** src/config/siteConfig.ts の siteName と同じ（静的なRSS src/pages/rss.xml.ts と同じタイトルにする） */
const SITE_NAME = "福富千恵と延岡を動かす会";
const CHANNEL_DESCRIPTION = "福富千恵と延岡を動かす会からのお知らせフィードです。";

function escapeXml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;")
    // XML 1.0 で使えない制御文字は取り除く（タブ・改行は残す）
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "");
}

/** リンク先を絶対URLにする。サイト内のパスはサイトのURLを付け、リンクが無い・不正な場合は /news/ にする */
export function absoluteLink(href: string, siteUrl: string): string {
  if (href.startsWith("/") && !href.startsWith("//")) return `${siteUrl}${href}`;
  if (/^https?:\/\//.test(href)) return href;
  return `${siteUrl}/news/`;
}

/** RSSのXMLを作る（並び順は渡された順＝/news/ と同じ） */
export function renderNewsRss(items: NewsDisplayItem[], siteUrl: string = SITE_URL): string {
  const links = items.map((item) => absoluteLink(item.href, siteUrl));
  const linkCount = new Map<string, number>();
  for (const link of links) linkCount.set(link, (linkCount.get(link) ?? 0) + 1);
  const entries = items.map((item, i) => {
    const link = links[i];
    // 記事ページ（/news/<slug>/）へのお知らせは、従来どおり記事URLをguidにする
    // （D1へ移行済みの記事も含め、RSSリーダーで既読の記事が新着に戻らないように）。
    // それ以外、または同じリンク先のお知らせが他にもある場合は、お知らせごとの識別子をguidにする
    const isArticle = item.key.startsWith("article:") || /^\/news\/[^/?#]+\/$/.test(item.href);
    const guid = isArticle && linkCount.get(link) === 1
      ? `<guid isPermaLink="true">${escapeXml(link)}</guid>`
      : `<guid isPermaLink="false">${escapeXml(`${siteUrl}/news/#${item.key}`)}</guid>`;
    const pubDate = new Date(`${item.date}T00:00:00.000Z`).toUTCString();
    return (
      `<item><title>${escapeXml(item.title)}</title><link>${escapeXml(link)}</link>${guid}` +
      `<description>${escapeXml(item.summary)}</description><pubDate>${pubDate}</pubDate>` +
      `<category>${escapeXml(item.category)}</category></item>`
    );
  });
  return (
    `<?xml version="1.0" encoding="UTF-8"?><rss version="2.0"><channel>` +
    `<title>${escapeXml(`${SITE_NAME}｜お知らせ`)}</title>` +
    `<description>${escapeXml(CHANNEL_DESCRIPTION)}</description>` +
    `<link>${escapeXml(`${siteUrl}/`)}</link><language>ja</language>` +
    entries.join("") +
    `</channel></rss>`
  );
}

async function fileNewsItems(env: PublicPageEnv, origin: string): Promise<NewsDisplayItem[]> {
  const res = await env.ASSETS.fetch(new URL("/news/file-items.json", origin));
  if (!res.ok) throw new Error("file_items_unavailable");
  const body = (await res.json()) as { items?: NewsDisplayItem[] };
  if (!Array.isArray(body.items)) throw new Error("file_items_invalid");
  return body.items;
}

/** GET /rss.xml の応答を作る */
export async function newsRssResponse(context: EventContext<PublicPageEnv, string, Record<string, unknown>>): Promise<Response> {
  const staticResponse = await context.env.ASSETS.fetch(context.request);
  if (staticResponse.status !== 200) return staticResponse;
  try {
    const db = context.env.STAFF_DB;
    if (!db) throw new Error("no_database");
    const today = todayInJapan();
    const [d1, fileItems] = await Promise.all([listPublicNews(db, today), fileNewsItems(context.env, new URL(context.request.url).origin)]);
    const xml = renderNewsRss(mergeNews(d1, fileItems, today));
    const headers = new Headers(staticResponse.headers);
    headers.delete("ETag");
    headers.delete("Content-Length");
    headers.set("Content-Type", "application/rss+xml; charset=utf-8");
    headers.set("Cache-Control", "public, max-age=0, must-revalidate");
    return new Response(context.request.method === "HEAD" ? null : xml, { status: 200, headers });
  } catch (err) {
    // 読めない場合は記事ファイルだけの静的なRSSを返す（詳細は返さない）
    // eslint-disable-next-line no-console
    console.error(JSON.stringify({ event: "news-rss-error", error: err instanceof Error ? err.message : "unknown" }));
    return staticResponse;
  }
}
