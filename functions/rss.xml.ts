// GET /rss.xml（お知らせのRSS）
// ビルド時の静的なRSS（記事ファイルだけ）を、D1（執行部ポータル /staff/news/ で公開したお知らせ）を含めた内容で作り直します。
// 中身・掲載順はトップページ・/news/ と同じです。下書き・非公開・掲載日前のお知らせは含めません。
// D1や記事一覧を読めない場合は、静的なRSS（公開済みの記事ファイル）をそのまま返します。

import { newsRssResponse } from "../server/newsRss";
import type { PublicPageEnv } from "../server/newsPublic";

export const onRequestGet: PagesFunction<PublicPageEnv> = (context) => newsRssResponse(context as never);
