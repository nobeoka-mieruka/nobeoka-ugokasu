// このファイルは Cloudflare Pages Functions（functions/dialogue/index.ts）からも読み込むため、
// siteConfig.ts など実行環境に依存するファイルを import しないでください（Workersで読み込み時にエラーになる）。
import type { DialogueEvent } from "../types/dialogue";
import { ORGANIZATION_ID, ORGANIZATION_NAME } from "../config/siteIdentity";
import { SITE_URL } from "../config/siteUrl";

const DIALOGUE_PAGE_URL = `${SITE_URL}/dialogue/`;

const WEEKDAYS = ["日", "月", "火", "水", "木", "金", "土"];
const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const TIME_PATTERN = /^\d{2}:\d{2}$/;

/** "2026-11-08" → "2026年11月8日（日）"。不正な値・空文字の場合は null */
export function formatDialogueDate(date: string): string | null {
  const match = DATE_PATTERN.exec(date);
  if (!match) return null;
  const [, y, m, d] = match.map(Number);
  // タイムゾーンの影響を受けないようUTCで曜日を求める
  const weekday = WEEKDAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
  return `${y}年${m}月${d}日（${weekday}）`;
}

/** "10:00" → "10:00"、"09:30" → "9:30" */
function formatTime(time: string): string {
  return time.replace(/^0(\d)/, "$1");
}

/** "10:00～11:30" の形式。開始時刻が未定なら null */
export function formatDialogueTime(event: Pick<DialogueEvent, "startTime" | "endTime">): string | null {
  if (!TIME_PATTERN.test(event.startTime)) return null;
  const start = formatTime(event.startTime);
  return TIME_PATTERN.test(event.endTime) ? `${start}～${formatTime(event.endTime)}` : `${start}～`;
}

/** 日本時間の今日（YYYY-MM-DD） */
export function todayInJapan(now: Date = new Date()): string {
  return new Date(now.getTime() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

/** 「これまでの意見交換会」に表示する回か（開催済みにした回と、開催日を過ぎた回） */
export function isPastDialogueEvent(event: DialogueEvent, today: string): boolean {
  return event.status === "completed" || event.eventDate < today;
}

/** 表示順：表示順の値 → 開催日 → 開始時刻 → 登録順 */
export function compareDialogueEvents(a: DialogueEvent, b: DialogueEvent): number {
  return (
    a.displayOrder - b.displayOrder ||
    a.eventDate.localeCompare(b.eventDate) ||
    a.startTime.localeCompare(b.startTime) ||
    a.id - b.id
  );
}

/** 開催日時・会場が確定し、受付中・受付終了の今後の回か（構造化データの出力条件） */
export function isDialogueEventConfirmed(event: DialogueEvent, today: string): boolean {
  return (
    (event.status === "open" || event.status === "closed") &&
    !isPastDialogueEvent(event, today) &&
    DATE_PATTERN.test(event.eventDate) &&
    TIME_PATTERN.test(event.startTime) &&
    event.venue.trim() !== ""
  );
}

/** 開催日時が確定している今後の回だけ schema.org Event 構造化データを生成する */
export function dialogueEventSchemas(events: DialogueEvent[], today: string) {
  return events
    .filter((event) => isDialogueEventConfirmed(event, today))
    .map((event) => ({
      "@context": "https://schema.org",
      "@type": "Event",
      name: `${event.title}｜${ORGANIZATION_NAME}`,
      ...(event.description.trim() ? { description: event.description } : {}),
      startDate: `${event.eventDate}T${event.startTime}:00+09:00`,
      ...(TIME_PATTERN.test(event.endTime) ? { endDate: `${event.eventDate}T${event.endTime}:00+09:00` } : {}),
      eventStatus: "https://schema.org/EventScheduled",
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
      ...(event.capacity ? { maximumAttendeeCapacity: event.capacity } : {}),
      organizer: { "@type": "Organization", "@id": ORGANIZATION_ID, name: ORGANIZATION_NAME, url: SITE_URL },
      url: DIALOGUE_PAGE_URL,
    }));
}
