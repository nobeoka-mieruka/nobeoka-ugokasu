// 公開ページのイベント表示（/events/ の一覧、トップページ「今後のイベント」）のHTMLを組み立てます。
//
// ・ビルド時（src/pages/events/index.astro・src/pages/index.astro）と、配信時（functions/events/index.ts・
//   functions/index.ts がD1の内容で差し替え）の両方で同じ関数を使い、デザインを1か所で管理します。
// ・受け取るのは公開してよい項目だけの PublicEvent（担当者・内部メモ等はそもそも持たない）。
// ・値はすべて escapeHtml を通してから埋め込みます（XSS対策）。
// ・Functionsからも読み込むため、実行環境に依存するファイル（siteConfig.ts 等）を import しないでください。

import { ORGANIZATION_ID, ORGANIZATION_NAME } from "../config/siteIdentity";
import { SITE_URL } from "../config/siteUrl";
import { EVENT_CATEGORY_LABELS, EVENT_STATUS_LABELS, type EventStatus, type PublicEvent } from "../types/events";
import { formatDialogueDate, formatDialogueTime } from "./dialogueEvents";
import { escapeHtml, jsonForScript } from "./html";

/** トップページに表示する件数 */
export const HOME_EVENTS_LIMIT = 3;
/** /events/ の「これまでのイベント」に表示する件数 */
const PAST_EVENTS_LIMIT = 20;

const EVENTS_PAGE_URL = `${SITE_URL}/events/`;

/** 開催日を過ぎた・終了したイベントか（中止は別扱い） */
export const isPastEvent = (event: PublicEvent, today: string) => event.status === "completed" || event.eventDate < today;

/** 今後のイベント（開催日の近い順）。中止のイベントも「中止」と表示するため含める */
export function upcomingEvents(events: PublicEvent[], today: string): PublicEvent[] {
  return events
    .filter((event) => !isPastEvent(event, today))
    .sort((a, b) => a.eventDate.localeCompare(b.eventDate) || a.startTime.localeCompare(b.startTime) || a.displayOrder - b.displayOrder || a.id - b.id);
}

const ICONS = {
  clock: '<circle cx="12" cy="12" r="9"/><polyline points="12 7 12 12 16 14"/>',
  location: '<path d="M12 21s-7-6.2-7-11.5A7 7 0 0 1 19 9.5C19 14.8 12 21 12 21z"/><circle cx="12" cy="9.5" r="2.5"/>',
} as const;
const icon = (name: keyof typeof ICONS, className: string) =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="${className}" aria-hidden="true">${ICONS[name]}</svg>`;

const STATUS_BADGE_CLASS: Record<EventStatus, string> = {
  open: "bg-brand-orange-dark text-white",
  scheduled: "bg-brand-orange-light text-brand-orange-dark",
  planning: "bg-black/5 text-ink-soft",
  preparing: "bg-black/5 text-ink-soft",
  completed: "bg-black/5 text-ink-soft",
  cancelled: "bg-red-50 text-red-800",
};

function eventCardHtml(event: PublicEvent, options: { withAnchor: boolean }): string {
  const date = formatDialogueDate(event.eventDate) ?? event.eventDate;
  const time = formatDialogueTime(event);
  const anchor = options.withAnchor ? ` id="event-${event.id}"` : "";
  return `<li class="card min-w-0 flex flex-col scroll-mt-24"${anchor} data-public-event>
  <div class="flex flex-wrap items-center gap-2">
    <span class="rounded-full bg-brand-orange-light px-2.5 py-1 text-sm font-bold text-ink">${escapeHtml(EVENT_CATEGORY_LABELS[event.category] ?? "その他")}</span>
    <span class="rounded-full px-2.5 py-1 text-sm font-bold ${STATUS_BADGE_CLASS[event.status]}">${escapeHtml(EVENT_STATUS_LABELS[event.status])}</span>
  </div>
  <h3 class="mt-3 text-xl font-bold text-ink leading-snug [overflow-wrap:anywhere]">${escapeHtml(event.title)}</h3>
  <dl class="mt-4 space-y-3 text-ink">
    <div class="flex items-start gap-3">
      <dt class="flex-shrink-0">${icon("clock", "w-5 h-5 mt-1 text-brand-orange-dark")}<span class="sr-only">日時</span></dt>
      <dd class="min-w-0"><p class="text-lg font-bold">${escapeHtml(date)}</p>${time ? `<p class="text-ink-soft">${escapeHtml(time)}</p>` : ""}</dd>
    </div>
    <div class="flex items-start gap-3">
      <dt class="flex-shrink-0">${icon("location", "w-5 h-5 mt-1 text-brand-orange-dark")}<span class="sr-only">会場</span></dt>
      <dd class="min-w-0 [overflow-wrap:anywhere]"><p class="font-bold">${escapeHtml(event.venue)}</p>${event.address ? `<p class="text-sm text-ink-soft">${escapeHtml(event.address)}</p>` : ""}</dd>
    </div>
  </dl>${event.description ? `\n  <p class="mt-4 text-ink-soft leading-relaxed whitespace-pre-line [overflow-wrap:anywhere]">${escapeHtml(event.description)}</p>` : ""}
</li>`;
}

/** /events/ の一覧（今後のイベント＋これまでのイベント） */
export function renderEventsPage(events: PublicEvent[], today: string): string {
  const upcoming = upcomingEvents(events, today);
  const past = events
    .filter((event) => isPastEvent(event, today) && event.status !== "cancelled")
    .sort((a, b) => b.eventDate.localeCompare(a.eventDate) || b.startTime.localeCompare(a.startTime))
    .slice(0, PAST_EVENTS_LIMIT);
  const upcomingHtml =
    upcoming.length > 0
      ? `<ul class="grid grid-cols-1 md:grid-cols-2 gap-6">\n${upcoming.map((event) => eventCardHtml(event, { withAnchor: true })).join("\n")}\n</ul>`
      : `<div class="card max-w-3xl mx-auto text-center text-ink-soft"><p class="text-lg">現在お知らせできるイベントはありません。決まり次第こちらでお知らせします。</p></div>`;
  if (past.length === 0) return upcomingHtml;
  const pastItems = past
    .map(
      (event) => `<li class="flex flex-col sm:flex-row sm:items-center gap-1 sm:gap-4 px-5 py-4 text-ink-soft scroll-mt-24" id="event-${event.id}">
      <span class="font-bold text-ink">${escapeHtml(formatDialogueDate(event.eventDate) ?? event.eventDate)}</span>
      <span class="min-w-0 [overflow-wrap:anywhere]">${escapeHtml(event.title)}</span>
      <span class="min-w-0 [overflow-wrap:anywhere]">${escapeHtml(event.venue)}</span>
    </li>`,
    )
    .join("\n");
  return `${upcomingHtml}
<div class="mt-12">
  <h2 class="text-xl font-bold text-ink mb-4">これまでのイベント</h2>
  <ul class="divide-y divide-black/5 rounded-2xl bg-white ring-1 ring-black/5">
    ${pastItems}
  </ul>
</div>`;
}

/**
 * トップページ「今後のイベント」セクション全体（直近3件。中止は出さない）。
 * 該当するイベントが無い場合は空文字（セクションごと表示しない。トップページを情報過多にしないため）。
 */
export function renderHomeEvents(events: PublicEvent[], today: string): string {
  const latest = upcomingEvents(events, today)
    .filter((event) => event.status !== "cancelled")
    .slice(0, HOME_EVENTS_LIMIT);
  if (latest.length === 0) return "";
  return `<section class="py-14 sm:py-16" aria-labelledby="home-events-heading">
  <div class="section-wrap">
    <div class="mb-10 sm:mb-12 text-left"><h2 id="home-events-heading" class="text-3xl sm:text-4xl font-bold text-ink whitespace-pre-line">今後のイベント</h2></div>
    <ul class="grid gap-4 sm:grid-cols-3">
${latest.map((event) => eventCardHtml(event, { withAnchor: false })).join("\n")}
    </ul>
    <div class="mt-8 text-center"><a href="/events/" class="btn-secondary">イベント一覧を見る</a></div>
  </div>
</section>`;
}

/** 今後のイベントの構造化データ（schema.org Event）。受付中・開催予定・中止のものだけ */
export function renderEventSchemaScripts(events: PublicEvent[], today: string): string {
  return upcomingEvents(events, today)
    .filter((event) => event.status === "open" || event.status === "scheduled" || event.status === "cancelled")
    .map((event) => {
      const schema = {
        "@context": "https://schema.org",
        "@type": "Event",
        name: `${event.title}｜${ORGANIZATION_NAME}`,
        ...(event.description.trim() ? { description: event.description } : {}),
        startDate: `${event.eventDate}T${event.startTime}:00+09:00`,
        ...(event.endTime ? { endDate: `${event.eventDate}T${event.endTime}:00+09:00` } : {}),
        eventStatus: event.status === "cancelled" ? "https://schema.org/EventCancelled" : "https://schema.org/EventScheduled",
        eventAttendanceMode: "https://schema.org/OfflineEventAttendanceMode",
        location: {
          "@type": "Place",
          name: event.venue,
          address: {
            "@type": "PostalAddress",
            ...(event.address.trim() ? { streetAddress: event.address } : {}),
            addressLocality: "延岡市",
            addressRegion: "宮崎県",
            addressCountry: "JP",
          },
        },
        organizer: { "@id": ORGANIZATION_ID },
        url: `${EVENTS_PAGE_URL}#event-${event.id}`,
      };
      return `<script type="application/ld+json" data-event-schema>${jsonForScript(schema)}</script>`;
    })
    .join("");
}
