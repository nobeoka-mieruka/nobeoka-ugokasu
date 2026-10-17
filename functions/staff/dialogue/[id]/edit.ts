// GET /staff/dialogue/:id/edit/ … 意見交換会の編集画面
// 画面そのものは静的HTML（src/pages/staff/dialogue/edit.astro）を返し、内容はブラウザが
// /staff/api/dialogue-events/:id から読み込みます。ログイン確認は functions/staff/_middleware.ts が行います。

import type { AssetsEnv, StaffAuthEnv } from "../../../../server/env";
import { parseDialogueId } from "../../../../server/dialogueEvents";
import { withStaffHeaders } from "../../../../server/staffAuth";

export const onRequestGet: PagesFunction<StaffAuthEnv & AssetsEnv, "id"> = async ({ request, env, params }) => {
  if (parseDialogueId(params.id) === null) {
    return withStaffHeaders(new Response("ページが見つかりません。", { status: 404, headers: { "Content-Type": "text/plain; charset=utf-8" } }));
  }
  const url = new URL(request.url);
  // 正規URLは末尾スラッシュあり
  if (!url.pathname.endsWith("/")) return withStaffHeaders(Response.redirect(`${url.origin}${url.pathname}/`, 308));
  return env.ASSETS.fetch(new URL("/staff/dialogue/edit/", url.origin));
};
