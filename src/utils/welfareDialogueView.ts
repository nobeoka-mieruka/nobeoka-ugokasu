// 「福祉の現場の声を聴く 意見交換会」の、日付によって変わる部分のHTMLです。
//
// ・受付状況のバッジ、各回の「受付中／受付終了／開催終了」、申込ボタン（受付中の回があるときだけ）、構造化データ。
// ・ビルド時（src/components/WelfareDialogueSection.astro・src/pages/dialogue.astro）と、
//   配信時（functions/dialogue/index.ts が日本時間の今日で [data-welfare-…] の中身を差し替える）の両方で同じ関数を使います。
//   そのため、ビルドした日の表示のまま固定されることはありません。
// ・Functionsからも読み込むため、Astroのコンポーネントや実行環境に依存するファイルを import しないでください。

import { dialogueConfig } from "../config/dialogueConfig";
import {
  WELFARE_DIALOGUE_TITLE,
  WELFARE_SESSION_STATUS_LABELS,
  welfareDialogueEvents,
  type WelfareDialogueState,
  type WelfareSessionStatus,
} from "../data/welfareDialogue";
import { renderDialogueSchemaScripts } from "./dialogueSchedule";
import { escapeHtml } from "./html";

const EXTERNAL_ICON =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="w-5 h-5" aria-hidden="true"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>';

/** 「参加を申し込む」は最も目立つ塗りボタン */
export const WELFARE_APPLY_BUTTON_CLASS = "btn-primary w-full sm:w-auto min-h-[60px] px-6 sm:px-10 text-xl shadow-md";

const STATUS_BADGE_CLASS: Record<WelfareSessionStatus, string> = {
  open: "bg-brand-orange-dark text-white",
  closed: "bg-white text-ink ring-1 ring-black/20",
  finished: "bg-black/5 text-ink-soft",
};

/** "2026-11-12" → "11月12日（木）" */
export function shortDate(date: string): string {
  const [y, m, d] = date.split("-").map(Number);
  const weekday = "日月火水木金土"[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
  return `${m}月${d}日（${weekday}）`;
}

/** 見出し上の募集バッジ */
export function renderWelfareBadge(state: WelfareDialogueState): string {
  if (state.anyOpen) return `<span class="rounded-full bg-brand-orange-dark px-3 py-1 text-white">参加者募集中</span>`;
  if (state.allFinished) return `<span class="rounded-full bg-black/5 px-3 py-1 text-ink-soft">全日程の開催を終了しました</span>`;
  return `<span class="rounded-full bg-white px-3 py-1 text-ink ring-1 ring-black/20">申込受付を終了しました</span>`;
}

/** 各回のカードに入れる受付状況と申込締切 */
export function renderWelfareSessionStatus(session: WelfareDialogueState["sessions"][number]): string {
  const label = WELFARE_SESSION_STATUS_LABELS[session.status];
  const deadline =
    session.status === "finished"
      ? ""
      : `<span class="text-sm ${session.status === "open" ? "font-bold text-ink" : "text-ink-soft"}">申込締切：${escapeHtml(shortDate(session.deadline))}まで</span>`;
  return `<span class="rounded-full px-3 py-1 text-sm font-bold ${STATUS_BADGE_CLASS[session.status]}" data-welfare-status-label="${session.status}">${label}</span>${deadline}`;
}

function applyButton(position: string): string {
  return `<a href="${escapeHtml(dialogueConfig.formUrl)}" target="_blank" rel="noopener noreferrer" class="${WELFARE_APPLY_BUTTON_CLASS}" data-welfare-apply data-track="dialogue_apply_click" data-track-type="${escapeHtml(position)}">参加を申し込む${EXTERNAL_ICON}<span class="sr-only">：${escapeHtml(WELFARE_DIALOGUE_TITLE)}（申込フォームが新しいタブで開きます）</span></a>`;
}

/**
 * 申込ボタンの部分。受付中の回があればボタンと受付中の回を、無ければ受付終了の案内だけを出す
 * （受付を終えた後に申込フォームへ案内しないため）。
 */
export function renderWelfareApply(state: WelfareDialogueState, position: "top" | "bottom"): string {
  if (!state.anyOpen) {
    const message = state.allFinished
      ? "全3回の開催を終了しました。ご参加・ご関心をお寄せいただいた皆さま、ありがとうございました。"
      : "申込の受付は終了しました。";
    return `<p class="rounded-xl bg-white ring-1 ring-black/10 px-5 py-4 text-lg font-bold text-ink" data-welfare-closed>${message}</p>`;
  }
  const open = state.sessions.filter((session) => session.status === "open");
  const rounds = open.map((session) => `第${session.round}回（${escapeHtml(shortDate(session.eventDate))}）`).join("・");
  const note = open.length === state.sessions.length ? "" : `<p class="text-base font-bold text-ink">受付中：${rounds}</p>`;
  return `${note}${applyButton(position)}`;
}

/** 意見交換会ページ下部「意見交換会 参加申込」のボタン部分（地域の意見交換会と共通の申込フォーム） */
export function renderDialogueFormApply(open: boolean): string {
  if (!open) {
    return `<p class="rounded-xl bg-white ring-1 ring-black/10 px-5 py-4 text-lg font-bold text-ink" data-dialogue-form-closed>現在、申込を受け付けている意見交換会はありません。</p>`;
  }
  return `<a href="${escapeHtml(dialogueConfig.formUrl)}" target="_blank" rel="noopener noreferrer" class="btn-primary w-full sm:w-auto min-h-[56px] justify-center text-lg" data-dialogue-form-open data-track="dialogue_apply_click" data-track-type="form_section">申込フォームを開く${EXTERNAL_ICON}<span class="sr-only">（新しいタブで開く）</span></a>`;
}

/** 各回の schema.org Event（開催日を過ぎた回は出さない。受付を終えた回は受付終了として出す） */
export function renderWelfareSchemaScripts(today: string): string {
  return renderDialogueSchemaScripts(welfareDialogueEvents(today), today);
}
