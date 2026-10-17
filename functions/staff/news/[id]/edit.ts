// GET /staff/news/:id/edit/ … お知らせの編集画面
// 画面そのものは静的HTML（src/pages/staff/news/edit.astro）を返し、内容はブラウザが
// /staff/api/news-items/:id から読み込みます。ログイン確認は functions/staff/_middleware.ts が行います。

import type { AssetsEnv, StaffAuthEnv } from "../../../../server/env";
import { withStaffHeaders } from "../../../../server/staffAuth";
import { parseId } from "../../../../server/validation";

export const onRequestGet: PagesFunction<StaffAuthEnv & AssetsEnv, "id"> = async ({ request, env, params }) => {
  if (parseId(params.id) === null) {
    return withStaffHeaders(new Response("ページが見つかりません。", { status: 404, headers: { "Content-Type": "text/plain; charset=utf-8" } }));
  }
  const url = new URL(request.url);
  // 正規URLは末尾スラッシュあり
  if (!url.pathname.endsWith("/")) return withStaffHeaders(Response.redirect(`${url.origin}${url.pathname}/`, 308));
  return env.ASSETS.fetch(new URL("/staff/news/edit/", url.origin));
};
