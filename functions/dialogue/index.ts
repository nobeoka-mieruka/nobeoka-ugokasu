// GET /dialogue/（公開ページ）
// 静的HTML（src/pages/dialogue.astro のビルド結果）を配信する際に、D1の開催予定で
// 「今後の意見交換会」「これまでの意見交換会」を差し替え、Event構造化データを追加します。
//
// ・認証は不要です。D1からは公開してよい項目だけを読み出します（作成者などは読まない）。
// ・D1に障害がある場合は、静的HTML（「日程調整中」の表示）をそのまま返します（ページ自体は必ず表示する）。
// ・ログ（dialogue-public-error）にはエラーの種類だけを出します。

import type { DialogueEnv } from "../../server/env";
import { listPublicDialogueEvents } from "../../server/dialogueEvents";
import { todayInJapan } from "../../src/utils/dialogueEvents";
import { renderDialogueSchedule, renderDialogueSchemaScripts } from "../../src/utils/dialogueSchedule";

export const onRequestGet: PagesFunction<DialogueEnv> = async (context) => {
  const response = await context.next();
  if (response.status !== 200 || !(response.headers.get("Content-Type") ?? "").includes("text/html")) return response;
  if (!context.env.STAFF_DB) return response;

  let scheduleHtml: string;
  let schemaHtml: string;
  try {
    const events = await listPublicDialogueEvents(context.env.STAFF_DB);
    const today = todayInJapan();
    scheduleHtml = renderDialogueSchedule(events, today);
    schemaHtml = renderDialogueSchemaScripts(events, today);
  } catch (err) {
    console.error(JSON.stringify({ event: "dialogue-public-error", error: err instanceof Error ? err.name : "unknown" }));
    return response;
  }

  const headers = new Headers(response.headers);
  // 内容が静的ファイルと変わるため、静的ファイル用の検証子は外し、毎回最新の予定を確認させる
  headers.delete("ETag");
  headers.delete("Content-Length");
  headers.set("Cache-Control", "public, max-age=0, must-revalidate");
  const rewritten = new HTMLRewriter()
    .on("[data-dialogue-schedule]", {
      element(el) {
        el.setInnerContent(scheduleHtml, { html: true });
      },
    })
    .on("head", {
      element(el) {
        if (schemaHtml) el.append(schemaHtml, { html: true });
      },
    })
    .transform(new Response(response.body, { status: response.status, headers }));
  return rewritten;
};
