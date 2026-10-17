// GET /（トップページ）
// 静的HTMLの「最新のお知らせ」を、D1（執行部ポータル /staff/news/ で登録）のお知らせで差し替えます。
// それ以外の部分（活動報告・SNS投稿など）は一切変更しません。処理は server/newsPublic.ts。

import { withNewsFromD1, type NewsPublicEnv } from "../server/newsPublic";
import { renderHomeNews } from "../src/utils/newsCards";

export const onRequestGet: PagesFunction<NewsPublicEnv> = (context) => withNewsFromD1(context, "[data-news-home]", renderHomeNews);
