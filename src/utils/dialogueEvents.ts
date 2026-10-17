import type { DialogueEvent } from "../data/dialogueEvents";
import { organizationId } from "./structuredData";
import { siteConfig } from "../config/siteConfig";
import { absoluteUrl } from "./seo";

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
export function formatDialogueTime(event: DialogueEvent): string | null {
  if (!TIME_PATTERN.test(event.startTime)) return null;
  const start = formatTime(event.startTime);
  return TIME_PATTERN.test(event.endTime) ? `${start}～${formatTime(event.endTime)}` : `${start}～`;
}

/** 日付・開始時刻・会場がすべて確定しているか（構造化データの出力条件） */
export function isDialogueEventConfirmed(event: DialogueEvent): boolean {
  return (
    event.status !== "日程調整中" &&
    DATE_PATTERN.test(event.date) &&
    TIME_PATTERN.test(event.startTime) &&
    event.venue.trim() !== ""
  );
}

/** 開催日時が確定している回だけ schema.org Event 構造化データを生成する */
export function dialogueEventSchemas(events: DialogueEvent[]) {
  return events.filter(isDialogueEventConfirmed).map((event) => ({
    "@context": "https://schema.org",
    "@type": "Event",
    name: `${event.title}｜${siteConfig.organizationName}`,
    ...(event.description.trim() ? { description: event.description } : {}),
    startDate: `${event.date}T${event.startTime}:00+09:00`,
    ...(TIME_PATTERN.test(event.endTime) ? { endDate: `${event.date}T${event.endTime}:00+09:00` } : {}),
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
    organizer: { "@id": organizationId },
    url: absoluteUrl("/dialogue"),
  }));
}
