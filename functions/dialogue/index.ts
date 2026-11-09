// GET /dialogue/（公開ページ）
// 静的HTML（src/pages/dialogue.astro のビルド結果）を配信する際に、次の部分をその日の内容に差し替えます。
//
// 1.「福祉の現場の声を聴く 意見交換会」（src/data/welfareDialogue.ts の固定の3回）
//    … 日本時間の今日で、募集バッジ・各回の受付中／受付終了／開催終了・申込ボタン・構造化データを差し替える。
//      D1を使わないため、D1に障害があっても必ず差し替える（ビルドした日の表示のまま残らない）。
// 2.「地域の意見交換会」（D1：執行部ポータル /staff/dialogue/ で登録）
//    … 「今後の意見交換会」「これまでの意見交換会」と、Event構造化データ。
//      D1に障害がある場合は、静的HTML（「日程調整中」の表示）のまま返す。
// 3. 下部「意見交換会 参加申込」のボタン … 1・2のどちらかに受付中の回があるときだけ表示する。
//
// ・認証は不要です。D1からは公開してよい項目だけを読み出します（作成者などは読まない）。
// ・ログ（dialogue-public-error）にはエラーの種類だけを出します。

import type { DialogueEnv } from "../../server/env";
import { listPublicDialogueEvents } from "../../server/dialogueEvents";
import { welfareDialogueState } from "../../src/data/welfareDialogue";
import type { DialogueEvent } from "../../src/types/dialogue";
import { isPastDialogueEvent, todayInJapan } from "../../src/utils/dialogueEvents";
import { renderDialogueSchedule, renderDialogueSchemaScripts } from "../../src/utils/dialogueSchedule";
import {
  renderDialogueFormApply,
  renderWelfareApply,
  renderWelfareBadge,
  renderWelfareSchemaScripts,
  renderWelfareSessionStatus,
} from "../../src/utils/welfareDialogueView";

/** 地域の意見交換会（D1）に、今申込を受け付けている回があるか */
export function hasOpenDialogueEvent(events: DialogueEvent[], today: string): boolean {
  return events.some((event) => event.status === "open" && event.applicationOpen && !isPastDialogueEvent(event, today));
}

export const onRequestGet: PagesFunction<DialogueEnv> = async (context) => {
  const response = await context.next();
  if (response.status !== 200 || !(response.headers.get("Content-Type") ?? "").includes("text/html")) return response;

  const today = todayInJapan();
  const welfare = welfareDialogueState(today);

  let d1Events: DialogueEvent[] | null = null;
  if (context.env.STAFF_DB) {
    try {
      d1Events = await listPublicDialogueEvents(context.env.STAFF_DB);
    } catch (err) {
      console.error(JSON.stringify({ event: "dialogue-public-error", error: err instanceof Error ? err.name : "unknown" }));
      d1Events = null;
    }
  }

  const replace = (html: string) => ({
    element(el: Element) {
      el.setInnerContent(html, { html: true });
    },
  });

  const headers = new Headers(response.headers);
  // 内容が日付・D1によって静的ファイルと変わるため、静的ファイル用の検証子は外し、毎回最新の内容を確認させる
  headers.delete("ETag");
  headers.delete("Content-Length");
  headers.set("Cache-Control", "public, max-age=0, must-revalidate");

  let rewriter = new HTMLRewriter()
    .on("[data-welfare-badge]", replace(renderWelfareBadge(welfare)))
    .on('[data-welfare-apply-area="top"]', replace(renderWelfareApply(welfare, "top")))
    .on('[data-welfare-apply-area="bottom"]', replace(renderWelfareApply(welfare, "bottom")))
    .on("[data-welfare-schema]", replace(renderWelfareSchemaScripts(today)));
  for (const session of welfare.sessions) {
    rewriter = rewriter.on(`[data-welfare-status="${session.round}"]`, replace(renderWelfareSessionStatus(session)));
  }

  // 申込ボタン：D1を読めない場合は、福祉の意見交換会の受付状況だけで判断する
  const formOpen = welfare.anyOpen || (d1Events !== null && hasOpenDialogueEvent(d1Events, today));
  rewriter = rewriter.on("[data-dialogue-form-apply]", replace(renderDialogueFormApply(formOpen)));

  if (d1Events !== null) {
    const scheduleHtml = renderDialogueSchedule(d1Events, today);
    const schemaHtml = renderDialogueSchemaScripts(d1Events, today);
    rewriter = rewriter.on("[data-dialogue-schedule]", replace(scheduleHtml));
    if (schemaHtml) {
      rewriter = rewriter.on("head", {
        element(el) {
          el.append(schemaHtml, { html: true });
        },
      });
    }
  }

  return rewriter.transform(new Response(response.body, { status: response.status, headers }));
};
