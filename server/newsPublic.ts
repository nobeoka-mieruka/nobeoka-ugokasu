// トップページ・/news/ の配信時に、お知らせ部分をD1の内容で差し替える共通処理です。
//
// ・静的HTML（ビルド結果）の [data-news-home] / [data-news-list] の中身を、
//   D1のお知らせ＋ファイル由来のお知らせ（/news/file-items.json）で組み立てたHTMLに置き換える。
// ・D1やJSONの読み込みに失敗した場合は、静的HTMLをそのまま返す（ページ自体は必ず表示する）。
// ・ログ（news-public-error）にはエラーの種類だけを出す。

import type { NewsDisplayItem } from "../src/types/news";
import { todayInJapan } from "../src/utils/dialogueEvents";
import { mergeNews } from "../src/utils/newsCards";
import type { AssetsEnv } from "./env";
import { listPublicNews } from "./newsItems";

export interface NewsPublicEnv extends AssetsEnv {
  STAFF_DB?: D1Database;
}

async function fileNewsItems(env: NewsPublicEnv, origin: string): Promise<NewsDisplayItem[]> {
  const res = await env.ASSETS.fetch(new URL("/news/file-items.json", origin));
  if (!res.ok) throw new Error("file_items_unavailable");
  const body = (await res.json()) as { items?: NewsDisplayItem[] };
  return Array.isArray(body.items) ? body.items : [];
}

/** 公開ページの静的HTMLのお知らせ部分を差し替えた応答を返す */
export async function withNewsFromD1(
  context: EventContext<NewsPublicEnv, string, Record<string, unknown>>,
  selector: "[data-news-home]" | "[data-news-list]",
  render: (items: NewsDisplayItem[]) => string,
): Promise<Response> {
  const response = await context.next();
  if (response.status !== 200 || !(response.headers.get("Content-Type") ?? "").includes("text/html")) return response;
  if (!context.env.STAFF_DB) return response;

  let html: string;
  try {
    const today = todayInJapan();
    const [d1, fileItems] = await Promise.all([
      listPublicNews(context.env.STAFF_DB, today),
      fileNewsItems(context.env, new URL(context.request.url).origin),
    ]);
    html = render(mergeNews(d1, fileItems, today));
  } catch (err) {
    console.error(JSON.stringify({ event: "news-public-error", error: err instanceof Error ? err.name : "unknown" }));
    return response;
  }

  const headers = new Headers(response.headers);
  // 内容が静的ファイルと変わるため、静的ファイル用の検証子は外し、毎回最新のお知らせを確認させる
  headers.delete("ETag");
  headers.delete("Content-Length");
  headers.set("Cache-Control", "public, max-age=0, must-revalidate");
  return new HTMLRewriter()
    .on(selector, {
      element(el) {
        el.setInnerContent(html, { html: true });
      },
    })
    .transform(new Response(response.body, { status: response.status, headers }));
}
