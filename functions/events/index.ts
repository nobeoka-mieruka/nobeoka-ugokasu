// GET /events/（イベント一覧・公開ページ）
// 静的HTMLのイベント一覧を、D1（執行部ポータル /staff/events/ で「一般公開」にしたもの）の内容で差し替え、
// Event構造化データを追加します。執行部のみのイベント・内部管理用の項目はD1から読み出しません（server/events.ts）。

import { eventsSection } from "../../server/eventsPublic";
import type { PublicPageEnv } from "../../server/newsPublic";
import { rewritePublicPage } from "../../server/publicRewrite";
import { renderEventSchemaScripts, renderEventsPage } from "../../src/utils/eventCards";

export const onRequestGet: PagesFunction<PublicPageEnv> = (context) =>
  rewritePublicPage(context as never, [eventsSection(context, "[data-events-list]", renderEventsPage, renderEventSchemaScripts)]);
