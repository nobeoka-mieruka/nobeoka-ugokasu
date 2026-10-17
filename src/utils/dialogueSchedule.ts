// 公開ページ /dialogue/ の「今後の意見交換会」「これまでの意見交換会」のHTMLを組み立てます。
//
// ・ビルド時（src/pages/dialogue.astro）と配信時（functions/dialogue/index.ts がD1の内容で差し替え）の
//   両方で同じ関数を使い、デザインを1か所で管理します。
// ・D1に保存された値はすべて escapeHtml を通してから埋め込みます（XSS対策）。
// ・Tailwindのクラス名はこのファイルからも読み取られます（tailwind.config.mjs の content に src/**/*.ts を含む）。

import { DIALOGUE_STATUS_LABELS, type DialogueEvent, type DialogueStatus } from "../types/dialogue";
import {
  compareDialogueEvents,
  dialogueEventSchemas,
  formatDialogueDate,
  formatDialogueTime,
  isPastDialogueEvent,
} from "./dialogueEvents";

import { escapeHtml, jsonForScript } from "./html";

export { escapeHtml, jsonForScript };

export const DIALOGUE_FORM_SECTION_ID = "dialogue-form";

// src/components/Icon.astro と同じ線画アイコン
const ICON_PATHS = {
  clock: '<circle cx="12" cy="12" r="9"/><polyline points="12 7 12 12 16 14"/>',
  location: '<path d="M12 21s-7-6.2-7-11.5A7 7 0 0 1 19 9.5C19 14.8 12 21 12 21z"/><circle cx="12" cy="9.5" r="2.5"/>',
  users:
    '<circle cx="9" cy="8" r="3"/><path d="M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6"/><circle cx="17" cy="9" r="2.5"/><path d="M15.5 14c2.5.3 4.5 2.5 4.5 6"/>',
  "chevron-down": '<polyline points="6 9 12 15 18 9"/>',
} as const;

function icon(name: keyof typeof ICON_PATHS, className: string): string {
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="${className}" aria-hidden="true">${ICON_PATHS[name]}</svg>`;
}

const STATUS_BADGE_CLASS: Record<DialogueStatus, string> = {
  open: "bg-brand-orange-dark text-white",
  closed: "bg-black/10 text-ink",
  completed: "bg-black/5 text-ink-soft",
  scheduling: "bg-brand-orange-light text-brand-orange-dark",
};

/** カード下部（申込ボタン、または受付状況の案内） */
function actionHtml(event: DialogueEvent): string {
  if (event.status === "open" && event.applicationOpen) {
    return `<a href="#${DIALOGUE_FORM_SECTION_ID}" data-scroll-to-form class="btn-primary w-full justify-center">参加を申し込む</a>`;
  }
  const message =
    event.status === "closed"
      ? "受付終了"
      : event.status === "scheduling"
        ? "現在、新しい意見交換会の日程を調整しています"
        : "お申し込み開始までお待ちください";
  return `<p class="rounded-xl bg-brand-ivory px-4 py-3 text-center text-sm font-bold text-ink-soft">${message}</p>`;
}

function upcomingCardHtml(event: DialogueEvent): string {
  const dateLabel = formatDialogueDate(event.eventDate) ?? "日程調整中";
  const timeLabel = formatDialogueTime(event);
  return `<li class="card min-w-0 flex flex-col" data-dialogue-event data-status="${event.status}">
  <div class="flex flex-wrap items-center justify-between gap-2">
    <h3 class="text-xl font-bold text-ink [overflow-wrap:anywhere]">${escapeHtml(event.title)}</h3>
    <span class="rounded-full px-3 py-1 text-sm font-bold ${STATUS_BADGE_CLASS[event.status]}">${DIALOGUE_STATUS_LABELS[event.status]}</span>
  </div>
  <dl class="mt-5 space-y-3 text-ink">
    <div class="flex items-start gap-3">
      <dt class="flex-shrink-0">${icon("clock", "w-5 h-5 mt-1 text-brand-orange-dark")}<span class="sr-only">日時</span></dt>
      <dd class="min-w-0">
        <p class="text-lg font-bold">${escapeHtml(dateLabel)}</p>${timeLabel ? `\n        <p class="text-ink-soft">${escapeHtml(timeLabel)}</p>` : ""}
      </dd>
    </div>
    <div class="flex items-start gap-3">
      <dt class="flex-shrink-0">${icon("location", "w-5 h-5 mt-1 text-brand-orange-dark")}<span class="sr-only">会場</span></dt>
      <dd class="min-w-0 [overflow-wrap:anywhere]">
        <p class="font-bold">${escapeHtml(event.venue || "会場調整中")}</p>${event.address ? `\n        <p class="text-sm text-ink-soft">${escapeHtml(event.address)}</p>` : ""}
      </dd>
    </div>${
      event.capacity
        ? `
    <div class="flex items-start gap-3">
      <dt class="flex-shrink-0">${icon("users", "w-5 h-5 mt-0.5 text-brand-orange-dark")}<span class="sr-only">定員</span></dt>
      <dd>定員 ${event.capacity}名</dd>
    </div>`
        : ""
    }
  </dl>${
    event.description
      ? `
  <p class="mt-5 text-ink-soft leading-relaxed whitespace-pre-line [overflow-wrap:anywhere]">${escapeHtml(event.description)}</p>`
      : ""
  }
  <div class="mt-auto pt-6">
    ${actionHtml(event)}
  </div>
</li>`;
}

const EMPTY_STATE_HTML = `<div class="card max-w-3xl mx-auto text-center flex flex-col items-center gap-4" data-dialogue-empty>
  <div class="flex items-center justify-center w-14 h-14 rounded-full bg-brand-orange-light">${icon("users", "w-7 h-7 text-brand-orange-dark")}</div>
  <p class="text-lg font-bold text-ink">現在、新しい意見交換会の日程を調整しています。</p>
  <p class="text-ink-soft leading-relaxed">開催をご希望の方は、下記の申込フォームからご希望の日程をお知らせください。</p>
  <a href="#${DIALOGUE_FORM_SECTION_ID}" data-scroll-to-form class="btn-secondary mt-2">申込フォームへ${icon("chevron-down", "w-5 h-5")}</a>
</div>`;

function pastListHtml(events: DialogueEvent[]): string {
  const items = events
    .map(
      (event) => `<li class="flex flex-col sm:flex-row sm:items-center gap-1 sm:gap-4 px-5 py-4 text-ink-soft" data-dialogue-past-event>
      <span class="font-bold text-ink">${escapeHtml(formatDialogueDate(event.eventDate) ?? "日付未記載")}</span>
      <span class="min-w-0 [overflow-wrap:anywhere]">${escapeHtml(event.title)}</span>
      <span class="min-w-0 [overflow-wrap:anywhere]">${escapeHtml(event.venue)}</span>
    </li>`,
    )
    .join("\n");
  return `<div class="mt-12">
  <h3 class="text-xl font-bold text-ink mb-4">これまでの意見交換会</h3>
  <ul class="divide-y divide-black/5 rounded-2xl bg-white ring-1 ring-black/5">
    ${items}
  </ul>
</div>`;
}

/** 公開ページの開催予定部分のHTML（「今後の意見交換会」の一覧＋「これまでの意見交換会」） */
export function renderDialogueSchedule(events: DialogueEvent[], today: string): string {
  const sorted = [...events].sort(compareDialogueEvents);
  const upcoming = sorted.filter((event) => !isPastDialogueEvent(event, today));
  // これまでの回は新しい順
  const past = sorted
    .filter((event) => isPastDialogueEvent(event, today))
    .sort((a, b) => b.eventDate.localeCompare(a.eventDate) || b.startTime.localeCompare(a.startTime));
  const upcomingHtml =
    upcoming.length > 0
      ? `<ul class="grid grid-cols-1 md:grid-cols-2 gap-6">\n${upcoming.map(upcomingCardHtml).join("\n")}\n</ul>`
      : EMPTY_STATE_HTML;
  return past.length > 0 ? `${upcomingHtml}\n${pastListHtml(past)}` : upcomingHtml;
}

/** 開催予定の構造化データ（schema.org Event）の <script> タグ。対象が無ければ空文字 */
export function renderDialogueSchemaScripts(events: DialogueEvent[], today: string): string {
  return dialogueEventSchemas(events, today)
    .map((schema) => `<script type="application/ld+json" data-dialogue-event-schema>${jsonForScript(schema)}</script>`)
    .join("");
}
