// トップページ・/news/ のお知らせ部分を、配信時にD1の内容で差し替えるための部品です（差し替えは server/publicRewrite.ts）。
//
// D1のお知らせと、ファイル由来のお知らせ（ビルド時に出力した /news/file-items.json：記事・SNS投稿の昇格）をまとめる。
// D1やJSONの読み込みに失敗した場合、お知らせ部分は静的HTMLのまま表示される。

import type { NewsDisplayItem } from "../src/types/news";
import { todayInJapan } from "../src/utils/dialogueEvents";
import { mergeNews } from "../src/utils/newsCards";
import type { AssetsEnv } from "./env";
import { listPublicNews } from "./newsItems";
import type { PublicSection } from "./publicRewrite";

export interface PublicPageEnv extends AssetsEnv {
  STAFF_DB?: D1Database;
}

async function fileNewsItems(env: PublicPageEnv, origin: string): Promise<NewsDisplayItem[]> {
  const res = await env.ASSETS.fetch(new URL("/news/file-items.json", origin));
  if (!res.ok) throw new Error("file_items_unavailable");
  const body = (await res.json()) as { items?: NewsDisplayItem[] };
  return Array.isArray(body.items) ? body.items : [];
}

/** お知らせ部分の差し替え内容 */
export function newsSection(
  context: EventContext<PublicPageEnv, string, Record<string, unknown>>,
  selector: "[data-news-home]" | "[data-news-list]",
  render: (items: NewsDisplayItem[]) => string,
): PublicSection {
  return {
    name: "news",
    selector,
    html: async () => {
      const db = context.env.STAFF_DB;
      if (!db) throw new Error("no_database");
      const today = todayInJapan();
      const [d1, fileItems] = await Promise.all([listPublicNews(db, today), fileNewsItems(context.env, new URL(context.request.url).origin)]);
      return render(mergeNews(d1, fileItems, today));
    },
  };
}
