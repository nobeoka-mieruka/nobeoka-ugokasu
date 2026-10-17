// イベント（D1: events）の保存・読み出し・入力値検証・「最新のお知らせ」との連携です。
//
// 【意見交換会との違い】意見交換会は dialogue_events（server/dialogueEvents.ts）で別に管理しています。
// このテーブルには意見交換会を登録しない運用です（カテゴリー「意見交換」は意見交換会以外の交流の催し用）。
//
// 【公開／内部】
// ・公開ページ用の読み出し（listPublicEvents）は、visibility = 'public' かつ削除されていない行の、
//   公開してよい列（PUBLIC_COLUMNS）だけを SELECT する。担当者・必要物品・内部メモ・ボランティア人数は読み出さない。
// ・新規登録時の公開範囲の初期値は「執行部のみ」（internal）。
//
// 【お知らせ連携】news_items.source_key = "event:<id>" で1対1に紐づける（重複して作られない）。
// ・「最新のお知らせにも掲載する」がオン、かつ一般公開のときだけ、カテゴリー「イベント」で掲載する。
// ・イベントを編集すると、お知らせのタイトル・概要も合わせて更新する（掲載日は最初の日のまま）。
// ・チェックを外した・執行部のみにした・削除した場合は、お知らせを非公開にする（削除はしない）。
//
// テーブルは最初のアクセス時に CREATE TABLE IF NOT EXISTS で作成する。同じ定義を migrations/0004_events.sql に置いている。
// 削除は論理削除。追加・編集・状態変更・公開範囲変更・削除は staff_audit_log に記録する。

import {
  EVENT_CATEGORIES,

  EVENT_STATUSES,
  EVENT_VISIBILITIES,
  type EventCategory,
  type EventRecord,
  type EventStatus,
  type EventVisibility,
  type PublicEvent,
} from "../src/types/events";
import { formatDialogueDate, formatDialogueTime, todayInJapan } from "../src/utils/dialogueEvents";
import { AUDIT_SCHEMA_SQL, auditLastInsertStatement, auditStatement, logStaffChange, nowSeconds } from "./auditLog";
import { ensureNewsSchema, syncNewsForSource, type SourceNewsResult } from "./newsItems";
import { boolValue, integerValue, isValidDate, textField } from "./validation";

export const EVENTS_SCHEMA_SQL: readonly string[] = [
  `CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  event_date TEXT NOT NULL,
  start_time TEXT NOT NULL,
  end_time TEXT NOT NULL DEFAULT '',
  venue TEXT NOT NULL,
  address TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '',
  category TEXT NOT NULL CHECK (category IN ('supporters', 'community', 'exchange', 'volunteer', 'street', 'meeting', 'other')),
  status TEXT NOT NULL CHECK (status IN ('planning', 'preparing', 'open', 'scheduled', 'completed', 'cancelled')),
  visibility TEXT NOT NULL DEFAULT 'internal' CHECK (visibility IN ('public', 'internal')),
  capacity INTEGER CHECK (capacity IS NULL OR capacity >= 0),
  volunteer_target INTEGER NOT NULL DEFAULT 0 CHECK (volunteer_target >= 0),
  volunteer_count INTEGER NOT NULL DEFAULT 0 CHECK (volunteer_count >= 0),
  person_in_charge TEXT NOT NULL DEFAULT '',
  required_items TEXT NOT NULL DEFAULT '',
  internal_notes TEXT NOT NULL DEFAULT '',
  display_order INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  created_by TEXT NOT NULL,
  updated_by TEXT NOT NULL,
  deleted_at INTEGER,
  deleted_by TEXT
)`,
  "CREATE INDEX IF NOT EXISTS events_listing ON events (deleted_at, visibility, event_date)",
  ...AUDIT_SCHEMA_SQL,
];

let schemaReady = new WeakSet<D1Database>();

/** テスト用：スキーマ作成済みの記録を消す */
export function resetEventsSchemaCache(): void {
  schemaReady = new WeakSet();
}

async function ensureEventsSchema(db: D1Database): Promise<void> {
  if (schemaReady.has(db)) return;
  await db.batch(EVENTS_SCHEMA_SQL.map((sql) => db.prepare(sql)));
  schemaReady.add(db);
}

// ---- 入力値検証 ----

export const EVENT_LIMITS = {
  title: 100,
  venue: 100,
  address: 200,
  description: 2000,
  personInCharge: 100,
  requiredItems: 1000,
  internalNotes: 2000,
  capacityMax: 100000,
  volunteerMax: 10000,
  displayOrderAbs: 9999,
} as const;

export interface EventInput {
  title: string;
  eventDate: string;
  startTime: string;
  endTime: string;
  venue: string;
  address: string;
  description: string;
  category: EventCategory;
  status: EventStatus;
  visibility: EventVisibility;
  capacity: number | null;
  volunteerTarget: number;
  volunteerCount: number;
  personInCharge: string;
  requiredItems: string;
  internalNotes: string;
  displayOrder: number;
  /** 「最新のお知らせにも掲載する」（一般公開のときだけ選べる） */
  postToNews: boolean;
}

export type EventFieldErrors = Partial<Record<keyof EventInput, string>>;
export type EventValidationResult<T> = { ok: true; value: T } | { ok: false; errors: EventFieldErrors };

const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;
const oneOf = <T extends string>(values: readonly T[], value: unknown): value is T => typeof value === "string" && (values as readonly string[]).includes(value);

/** 0以上の整数（空欄は null）。範囲外・小数・文字は "invalid" */
function nonNegative(value: unknown, max: number): number | null | "invalid" {
  const parsed = integerValue(value);
  if (parsed === "invalid" || (parsed !== null && (parsed < 0 || parsed > max))) return "invalid";
  return parsed;
}

/** 新規登録・編集の入力値を検証する（サーバー側で必ず実行する） */
export function validateEventInput(raw: unknown): EventValidationResult<EventInput> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { ok: false, errors: { title: "入力内容を読み取れませんでした。" } };
  const body = raw as Record<string, unknown>;
  const errors: EventFieldErrors = {};
  const L = EVENT_LIMITS;

  const title = textField(body, "title", "イベント名", { required: true, max: L.title }, errors);
  const venue = textField(body, "venue", "会場", { required: true, max: L.venue }, errors);
  const address = textField(body, "address", "住所", { required: false, max: L.address }, errors);
  const description = textField(body, "description", "概要", { required: false, max: L.description, multiline: true }, errors);
  const personInCharge = textField(body, "personInCharge", "担当者", { required: false, max: L.personInCharge }, errors);
  const requiredItems = textField(body, "requiredItems", "必要物品", { required: false, max: L.requiredItems, multiline: true }, errors);
  const internalNotes = textField(body, "internalNotes", "内部メモ", { required: false, max: L.internalNotes, multiline: true }, errors);

  const eventDate = typeof body.eventDate === "string" ? body.eventDate.trim() : "";
  if (!isValidDate(eventDate)) errors.eventDate = "開催日を正しく入力してください（例：2026-11-08）。";
  const startTime = typeof body.startTime === "string" ? body.startTime.trim() : "";
  if (!TIME_PATTERN.test(startTime)) errors.startTime = "開始時間を正しく入力してください（例：10:00）。";
  const endTime = typeof body.endTime === "string" ? body.endTime.trim() : "";
  if (endTime !== "" && !TIME_PATTERN.test(endTime)) errors.endTime = "終了時間を正しく入力してください（例：12:00）。";
  else if (endTime !== "" && !errors.startTime && endTime <= startTime) errors.endTime = "終了時間は開始時間より後にしてください。";

  if (!oneOf(EVENT_CATEGORIES, body.category)) errors.category = "カテゴリーを選択してください。";
  if (!oneOf(EVENT_STATUSES, body.status)) errors.status = "ステータスを選択してください。";
  if (!oneOf(EVENT_VISIBILITIES, body.visibility)) errors.visibility = "公開範囲を選択してください。";

  const capacity = nonNegative(body.capacity, L.capacityMax);
  if (capacity === "invalid") errors.capacity = `定員は0〜${L.capacityMax}の整数で入力してください（定員なしの場合は空欄）。`;
  const volunteerTarget = nonNegative(body.volunteerTarget, L.volunteerMax);
  if (volunteerTarget === "invalid") errors.volunteerTarget = `ボランティア募集目標人数は0〜${L.volunteerMax}の整数で入力してください。`;
  const volunteerCount = nonNegative(body.volunteerCount, L.volunteerMax);
  if (volunteerCount === "invalid") errors.volunteerCount = `現在のボランティア人数は0〜${L.volunteerMax}の整数で入力してください。`;

  const displayOrder = integerValue(body.displayOrder);
  if (displayOrder === "invalid" || (displayOrder !== null && Math.abs(displayOrder) > L.displayOrderAbs)) {
    errors.displayOrder = `表示順は-${L.displayOrderAbs}〜${L.displayOrderAbs}の整数で入力してください。`;
  }

  const postToNews = boolValue(body.postToNews);
  if (postToNews === null) errors.postToNews = "「最新のお知らせにも掲載する」の形式が正しくありません。";
  else if (postToNews && body.visibility === "internal") {
    errors.postToNews = "「執行部のみ」のイベントは、最新のお知らせに掲載できません。";
  }

  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return {
    ok: true,
    value: {
      title,
      eventDate,
      startTime,
      endTime,
      venue,
      address,
      description,
      category: body.category as EventCategory,
      status: body.status as EventStatus,
      visibility: body.visibility as EventVisibility,
      capacity: capacity as number | null,
      volunteerTarget: (volunteerTarget as number | null) ?? 0,
      volunteerCount: (volunteerCount as number | null) ?? 0,
      personInCharge,
      requiredItems,
      internalNotes,
      displayOrder: (displayOrder as number | null) ?? 0,
      postToNews: postToNews as boolean,
    },
  };
}

/** 一覧画面からのステータス変更（PATCH）の入力値を検証する */
export function validateEventStatusChange(raw: unknown): EventValidationResult<{ status: EventStatus }> {
  const body = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  if (!oneOf(EVENT_STATUSES, body.status)) return { ok: false, errors: { status: "ステータスを選択してください。" } };
  return { ok: true, value: { status: body.status } };
}

// ---- 読み出し ----

interface EventRow {
  id: number;
  title: string;
  event_date: string;
  start_time: string;
  end_time: string;
  venue: string;
  address: string;
  description: string;
  category: EventCategory;
  status: EventStatus;
  display_order: number;
  visibility: EventVisibility;
  capacity: number | null;
  volunteer_target: number;
  volunteer_count: number;
  person_in_charge: string;
  required_items: string;
  internal_notes: string;
  created_at: number;
  updated_at: number;
  created_by: string;
  updated_by: string;
  posted_to_news: number;
}

/** 公開ページで使ってよい列だけ（内部管理用の列は含めない） */
const PUBLIC_COLUMNS = "id, title, event_date, start_time, end_time, venue, address, description, category, status, display_order";
const ADMIN_COLUMNS = `e.id, e.title, e.event_date, e.start_time, e.end_time, e.venue, e.address, e.description, e.category, e.status, e.display_order,
  e.visibility, e.capacity, e.volunteer_target, e.volunteer_count, e.person_in_charge, e.required_items, e.internal_notes,
  e.created_at, e.updated_at, e.created_by, e.updated_by,
  EXISTS (SELECT 1 FROM news_items n WHERE n.source_key = 'event:' || e.id AND n.deleted_at IS NULL AND n.is_published = 1) AS posted_to_news`;
const LIST_LIMIT = 500;

function toPublic(row: Pick<EventRow, "id" | "title" | "event_date" | "start_time" | "end_time" | "venue" | "address" | "description" | "category" | "status" | "display_order">): PublicEvent {
  return {
    id: row.id,
    title: row.title,
    eventDate: row.event_date,
    startTime: row.start_time,
    endTime: row.end_time ?? "",
    venue: row.venue,
    address: row.address ?? "",
    description: row.description ?? "",
    category: row.category,
    status: row.status,
    displayOrder: row.display_order,
  };
}

function toRecord(row: EventRow): EventRecord {
  return {
    ...toPublic(row),
    visibility: row.visibility,
    capacity: row.capacity ?? null,
    volunteerTarget: row.volunteer_target,
    volunteerCount: row.volunteer_count,
    personInCharge: row.person_in_charge,
    requiredItems: row.required_items,
    internalNotes: row.internal_notes,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    createdBy: row.created_by,
    updatedBy: row.updated_by,
    postedToNews: row.posted_to_news === 1,
  };
}

/** 公開ページ用：一般公開・削除されていないイベント（公開してよい列だけ） */
export async function listPublicEvents(db: D1Database): Promise<PublicEvent[]> {
  await ensureEventsSchema(db);
  const { results } = await db
    .prepare(
      `SELECT ${PUBLIC_COLUMNS} FROM events WHERE deleted_at IS NULL AND visibility = 'public'
       ORDER BY event_date ASC, start_time ASC, display_order ASC, id ASC LIMIT ${LIST_LIMIT}`,
    )
    .all<EventRow>();
  return results.map(toPublic);
}

/** 執行部ポータル用：削除されていないすべてのイベント（並び替えは画面側で今後／終了済みに分ける） */
export async function listEvents(db: D1Database): Promise<EventRecord[]> {
  await ensureEventsSchema(db);
  await ensureNewsSchema(db);
  const { results } = await db
    .prepare(
      `SELECT ${ADMIN_COLUMNS} FROM events e WHERE e.deleted_at IS NULL
       ORDER BY e.event_date ASC, e.start_time ASC, e.display_order ASC, e.id ASC LIMIT ${LIST_LIMIT}`,
    )
    .all<EventRow>();
  return results.map(toRecord);
}

export async function getEvent(db: D1Database, id: number): Promise<EventRecord | null> {
  await ensureEventsSchema(db);
  await ensureNewsSchema(db);
  const row = await db.prepare(`SELECT ${ADMIN_COLUMNS} FROM events e WHERE e.id = ?1 AND e.deleted_at IS NULL`).bind(id).first<EventRow>();
  return row ? toRecord(row) : null;
}

// ---- お知らせ連携 ----

export const eventNewsSourceKey = (id: number) => `event:${id}`;

/** イベントから作るお知らせの内容（公開してよい項目だけで作る） */
export function eventNewsContent(event: PublicEvent, publishedOn: string) {
  const date = formatDialogueDate(event.eventDate) ?? event.eventDate;
  const time = formatDialogueTime(event);
  const parts = [`${date}${time ? ` ${time}` : ""}`, `会場：${event.venue}`];
  const lead = parts.join("、") + "。";
  const description = event.description.replace(/\s+/g, " ").trim();
  const summary = [...(description ? `${lead}${description}` : lead)];
  return {
    publishedOn,
    category: "event" as const,
    title: event.title,
    summary: summary.length > 300 ? `${summary.slice(0, 299).join("")}…` : summary.join(""),
    linkUrl: `/events/#event-${event.id}`,
  };
}

/** イベントの状態に合わせて、紐づくお知らせを作成・更新・非公開にする */
async function syncEventNews(db: D1Database, event: PublicEvent, publish: boolean, actor: string): Promise<SourceNewsResult> {
  return syncNewsForSource(db, eventNewsSourceKey(event.id), eventNewsContent(event, todayInJapan()), publish, actor);
}

// ---- 書き込み（イベントの変更は操作ログと同じトランザクションで記録する） ----

export type EventAction = "event.create" | "event.update" | "event.status" | "event.visibility" | "event.delete";
const AUDIT_TARGET = "event";
const logAction = (action: EventAction, id: number, detail: Record<string, unknown>) => logStaffChange("staff-event-change", action, id, detail);

type StoredEventInput = Omit<EventInput, "postToNews">;

const INPUT_COLUMNS: Record<keyof StoredEventInput, string> = {
  title: "title",
  eventDate: "event_date",
  startTime: "start_time",
  endTime: "end_time",
  venue: "venue",
  address: "address",
  description: "description",
  category: "category",
  status: "status",
  visibility: "visibility",
  capacity: "capacity",
  volunteerTarget: "volunteer_target",
  volunteerCount: "volunteer_count",
  personInCharge: "person_in_charge",
  requiredItems: "required_items",
  internalNotes: "internal_notes",
  displayOrder: "display_order",
};
const INPUT_KEYS = Object.keys(INPUT_COLUMNS) as (keyof StoredEventInput)[];
const COLUMN_COUNT = INPUT_KEYS.length; // 17

const columnValues = (input: StoredEventInput): unknown[] => INPUT_KEYS.map((key) => input[key]);

/** 内部管理用の項目は、操作ログに内容を残さず項目名だけを記録する */
const changedKeys = (before: EventRecord, input: StoredEventInput) => INPUT_KEYS.filter((key) => before[key] !== input[key]);

export interface EventWriteResult {
  event: EventRecord;
  news: SourceNewsResult;
}

export async function createEvent(db: D1Database, input: EventInput, actor: string): Promise<EventWriteResult> {
  await ensureEventsSchema(db);
  const now = nowSeconds();
  const columns = Object.values(INPUT_COLUMNS);
  const detail = { status: input.status, visibility: input.visibility, category: input.category };
  const [inserted] = await db.batch<{ id: number }>([
    db
      .prepare(
        `INSERT INTO events (${columns.join(", ")}, created_at, updated_at, created_by, updated_by)
         VALUES (${columns.map((_, i) => `?${i + 1}`).join(", ")}, ?${COLUMN_COUNT + 1}, ?${COLUMN_COUNT + 1}, ?${COLUMN_COUNT + 2}, ?${COLUMN_COUNT + 2})
         RETURNING id`,
      )
      .bind(...columnValues(input), now, actor),
    auditLastInsertStatement(db, "event.create", AUDIT_TARGET, actor, detail, now),
  ]);
  const id = inserted?.results?.[0]?.id;
  if (!id) throw new Error("event_insert_failed");
  logAction("event.create", id, detail);
  const event = (await getEvent(db, id))!;
  const news = input.postToNews && input.visibility === "public" ? await syncEventNews(db, event, true, actor) : "none";
  return { event: news === "none" ? event : (await getEvent(db, id))!, news };
}

/** 編集。対象が無い（削除済みを含む）場合は null */
export async function updateEvent(db: D1Database, id: number, input: EventInput, actor: string): Promise<EventWriteResult | null> {
  const before = await getEvent(db, id);
  if (!before) return null;
  const now = nowSeconds();
  const changed = changedKeys(before, input);
  const assignments = Object.values(INPUT_COLUMNS).map((column, i) => `${column} = ?${i + 1}`);
  const statements = [
    db
      .prepare(
        `UPDATE events SET ${assignments.join(", ")}, updated_at = ?${COLUMN_COUNT + 1}, updated_by = ?${COLUMN_COUNT + 2}
         WHERE id = ?${COLUMN_COUNT + 3} AND deleted_at IS NULL`,
      )
      .bind(...columnValues(input), now, actor, id),
    auditStatement(db, "event.update", AUDIT_TARGET, id, actor, { changed }, now),
  ];
  // ステータス・公開範囲の変更は、後から追いやすいよう個別にも記録する
  if (before.status !== input.status) statements.push(auditStatement(db, "event.status", AUDIT_TARGET, id, actor, { from: before.status, to: input.status }, now));
  if (before.visibility !== input.visibility) {
    statements.push(auditStatement(db, "event.visibility", AUDIT_TARGET, id, actor, { from: before.visibility, to: input.visibility }, now));
  }
  await db.batch(statements);
  logAction("event.update", id, { changed });
  const updated = (await getEvent(db, id))!;
  const news = await syncEventNews(db, updated, input.postToNews && input.visibility === "public", actor);
  return { event: news === "none" ? updated : (await getEvent(db, id))!, news };
}

/** ステータスの変更。対象が無い場合は null */
export async function changeEventStatus(db: D1Database, id: number, status: EventStatus, actor: string): Promise<EventRecord | null> {
  const before = await getEvent(db, id);
  if (!before) return null;
  const now = nowSeconds();
  const detail = { from: before.status, to: status };
  await db.batch([
    db.prepare("UPDATE events SET status = ?1, updated_at = ?2, updated_by = ?3 WHERE id = ?4 AND deleted_at IS NULL").bind(status, now, actor, id),
    auditStatement(db, "event.status", AUDIT_TARGET, id, actor, detail, now),
  ]);
  logAction("event.status", id, detail);
  return getEvent(db, id);
}

/** 削除（論理削除）。紐づくお知らせは非公開にする。対象が無い場合は null */
export async function deleteEvent(db: D1Database, id: number, actor: string): Promise<{ news: SourceNewsResult } | null> {
  const before = await getEvent(db, id);
  if (!before) return null;
  const now = nowSeconds();
  await db.batch([
    db.prepare("UPDATE events SET deleted_at = ?1, deleted_by = ?2, updated_at = ?1, updated_by = ?2 WHERE id = ?3 AND deleted_at IS NULL").bind(now, actor, id),
    auditStatement(db, "event.delete", AUDIT_TARGET, id, actor, {}, now),
  ]);
  logAction("event.delete", id, {});
  return { news: await syncEventNews(db, before, false, actor) };
}

