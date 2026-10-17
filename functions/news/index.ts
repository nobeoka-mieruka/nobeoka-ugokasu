// GET /news/（お知らせ一覧）
// 静的HTMLのお知らせ一覧を、D1（執行部ポータル /staff/news/ で登録）のお知らせを含めた内容で差し替えます。
// 記事の個別ページ（/news/<slug>/）にはこのFunctionは使われません。

import { newsSection, type PublicPageEnv } from "../../server/newsPublic";
import { rewritePublicPage } from "../../server/publicRewrite";
import { renderNewsList } from "../../src/utils/newsCards";

export const onRequestGet: PagesFunction<PublicPageEnv> = (context) =>
  rewritePublicPage(context as never, [newsSection(context, "[data-news-list]", renderNewsList)]);
