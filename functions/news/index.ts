// GET /news/（お知らせ一覧）
// 静的HTMLのお知らせ一覧を、D1（執行部ポータル /staff/news/ で登録）のお知らせを含めた内容で差し替えます。
// 記事の個別ページ（/news/<slug>/）にはこのFunctionは使われません。処理は server/newsPublic.ts。

import { withNewsFromD1, type NewsPublicEnv } from "../../server/newsPublic";
import { renderNewsList } from "../../src/utils/newsCards";

export const onRequestGet: PagesFunction<NewsPublicEnv> = (context) => withNewsFromD1(context, "[data-news-list]", renderNewsList);
