// GET /（トップページ）
// 静的HTMLの「最新のお知らせ」と「今後のイベント」を、D1（執行部ポータルで登録）の内容で差し替えます。
// それ以外の部分（活動報告・SNS投稿など）は一切変更しません。
// お知らせ・イベントのどちらかの読み込みに失敗しても、その部分だけ静的HTMLのまま表示します（server/publicRewrite.ts）。

import { eventsSection } from "../server/eventsPublic";
import { newsSection, type PublicPageEnv } from "../server/newsPublic";
import { rewritePublicPage } from "../server/publicRewrite";
import { renderHomeEvents } from "../src/utils/eventCards";
import { renderHomeNews } from "../src/utils/newsCards";

export const onRequestGet: PagesFunction<PublicPageEnv> = (context) =>
  rewritePublicPage(context as never, [
    newsSection(context, "[data-news-home]", renderHomeNews),
    eventsSection(context, "[data-events-home]", renderHomeEvents),
  ]);
