// /news/file-items.json（ビルド時に生成する静的ファイル）
// ファイルで管理しているお知らせ（記事・SNS投稿の昇格）を、公開ページ表示用の形で出力します。
// 配信時に functions/index.ts・functions/news/index.ts が読み込み、D1のお知らせとまとめて表示します。
// 中身はすでに公開しているお知らせだけです（下書きの記事は含まれません）。
import type { APIRoute } from "astro";
import { getFileNewsItems } from "../../data/news";

export const GET: APIRoute = async () =>
  new Response(JSON.stringify({ items: await getFileNewsItems() }), {
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
