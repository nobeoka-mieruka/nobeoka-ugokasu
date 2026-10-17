// 意見交換会の開催予定（D1: dialogue_events）の保存・読み出し・入力値検証・操作ログです。
//
// ・テーブルは、最初のアクセス時に CREATE TABLE IF NOT EXISTS で作成する（既存テーブルには触れない）。
//   同じ内容を migrations/0002_dialogue_events.sql にも置いている（npm run d1:migrate で明示的にも適用できる）。
// ・削除は「論理削除」（deleted_at を記録し、一覧・公開ページから外す）。行は残るため、誤って削除しても復元できる。
// ・追加・編集・状態変更・削除は staff_audit_log に記録する（操作者のメールアドレスはD1内にのみ保存し、
//   サーバーログには操作の種類とIDだけを出す）。

import { DIALOGUE_STATUSES, type DialogueEvent, type DialogueEventRecord, type DialogueStatus } from "../src/types/dialogue";
import { AUDIT_SCHEMA_SQL, auditLastInsertStatement, auditStatement as sharedAuditStatement, logStaffChange, nowSeconds } from "./auditLog";
import { boolValue, integerValue, isValidDate, parseId, textField } from "./validation";

export const DIALOGUE_SCHEMA_SQL: readonly string[] = [
  `CREATE TABLE IF NOT EXISTS dialogue_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  event_date TEXT NOT NULL,
  start_time TEXT NOT NULL,
  end_time TEXT NOT NULL DEFAULT '',
  venue TEXT NOT NULL,
  address TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '',
  capacity INTEGER CHECK (capacity IS NULL OR capacity > 0),
  status TEXT NOT NULL CHECK (status IN ('open', 'closed', 'scheduling', 'completed')),
  application_open INTEGER NOT NULL DEFAULT 0 CHECK (application_open IN (0, 1)),
  is_published INTEGER NOT NULL DEFAULT 1 CHECK (is_published IN (0, 1)),
  display_order INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  created_by TEXT NOT NULL,
  updated_by TEXT NOT NULL,
  deleted_at INTEGER,
  deleted_by TEXT
)`,
  "CREATE INDEX IF NOT EXISTS dialogue_events_listing ON dialogue_events (deleted_at, is_published, event_date)",
  ...AUDIT_SCHEMA_SQL,
];

let schemaReady = new WeakSet<D1Database>();

/** テスト用：スキーマ作成済みの記録を消す */
export function resetDialogueSchemaCache(): void {
  schemaReady = new WeakSet();
}

async function ensureDialogueSchema(db: D1Database): Promise<void> {
  if (schemaReady.has(db)) return;
  await db.batch(DIALOGUE_SCHEMA_SQL.map((sql) => db.prepare(sql)));
  schemaReady.add(db);
}

// ---- 入力値検証 ----

export const DIALOGUE_LIMITS = {
  title: 100,
  venue: 100,
  address: 200,
  description: 2000,
  capacityMax: 10000,
  displayOrderAbs: 9999,
} as const;

/** フォームから受け取る値（未検証） */
export interface DialogueEventInput {
  title: string;
  eventDate: string;
  startTime: string;
  endTime: string;
  venue: string;
  address: string;
  description: string;
  capacity: number | null;
  status: DialogueStatus;
  applicationOpen: boolean;
  isPublished: boolean;
  displayOrder: number;
}

export type DialogueFieldErrors = Partial<Record<keyof DialogueEventInput, string>>;
export type ValidationResult<T> = { ok: true; value: T } | { ok: false; errors: DialogueFieldErrors };

const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

function isStatus(value: unknown): value is DialogueStatus {
  return typeof value === "string" && (DIALOGUE_STATUSES as readonly string[]).includes(value);
}

/** 新規登録・編集の入力値を検証する（サーバー側で必ず実行する） */
export function validateDialogueInput(raw: unknown): ValidationResult<DialogueEventInput> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { ok: false, errors: { title: "入力内容を読み取れませんでした。" } };
  const body = raw as Record<string, unknown>;
  const errors: DialogueFieldErrors = {};

  const title = textField(body, "title", "タイトル", { required: true, max: DIALOGUE_LIMITS.title }, errors);
  const venue = textField(body, "venue", "会場", { required: true, max: DIALOGUE_LIMITS.venue }, errors);
  const address = textField(body, "address", "住所", { required: false, max: DIALOGUE_LIMITS.address }, errors);
  const description = textField(body, "description", "説明", { required: false, max: DIALOGUE_LIMITS.description, multiline: true }, errors);

  const eventDate = typeof body.eventDate === "string" ? body.eventDate.trim() : "";
  if (!isValidDate(eventDate)) errors.eventDate = "開催日を正しく入力してください（例：2026-11-08）。";

  const startTime = typeof body.startTime === "string" ? body.startTime.trim() : "";
  if (!TIME_PATTERN.test(startTime)) errors.startTime = "開始時間を正しく入力してください（例：10:00）。";

  const endTime = typeof body.endTime === "string" ? body.endTime.trim() : "";
  if (endTime !== "" && !TIME_PATTERN.test(endTime)) errors.endTime = "終了時間を正しく入力してください（例：11:30）。";
  else if (endTime !== "" && !errors.startTime && endTime <= startTime) errors.endTime = "終了時間は開始時間より後にしてください。";

  const capacity = integerValue(body.capacity);
  if (capacity === "invalid" || (capacity !== null && (capacity < 1 || capacity > DIALOGUE_LIMITS.capacityMax))) {
    errors.capacity = `定員は1〜${DIALOGUE_LIMITS.capacityMax}の整数で入力してください（定員なしの場合は空欄）。`;
  }

  if (!isStatus(body.status)) errors.status = "受付状況を選択してください。";

  const applicationOpen = boolValue(body.applicationOpen);
  if (applicationOpen === null) errors.applicationOpen = "受付可否の形式が正しくありません。";
  const isPublished = body.isPublished === undefined ? true : boolValue(body.isPublished);
  if (isPublished === null) errors.isPublished = "公開状態の形式が正しくありません。";

  const displayOrder = integerValue(body.displayOrder);
  if (displayOrder === "invalid" || (displayOrder !== null && Math.abs(displayOrder) > DIALOGUE_LIMITS.displayOrderAbs)) {
    errors.displayOrder = `表示順は-${DIALOGUE_LIMITS.displayOrderAbs}〜${DIALOGUE_LIMITS.displayOrderAbs}の整数で入力してください。`;
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
      capacity: capacity as number | null,
      status: body.status as DialogueStatus,
      applicationOpen: applicationOpen as boolean,
      isPublished: isPublished as boolean,
      displayOrder: (displayOrder as number | null) ?? 0,
    },
  };
}

/** 受付状況の変更（一覧画面からの PATCH）の入力値を検証する */
export function validateStatusChange(raw: unknown): ValidationResult<{ status: DialogueStatus; applicationOpen?: boolean }> {
  const body = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  if (!isStatus(body.status)) return { ok: false, errors: { status: "受付状況を選択してください。" } };
  if (body.applicationOpen === undefined) return { ok: true, value: { status: body.status } };
  const applicationOpen = boolValue(body.applicationOpen);
  if (applicationOpen === null) return { ok: false, errors: { applicationOpen: "受付可否の形式が正しくありません。" } };
  return { ok: true, value: { status: body.status, applicationOpen } };
}

/** URLの :id を検証する（正の整数のみ） */
export const parseDialogueId = parseId;

// ---- 読み出し ----

interface DialogueRow {
  id: number;
  title: string;
  event_date: string;
  start_time: string;
  end_time: string;
  venue: string;
  address: string;
  description: string;
  capacity: number | null;
  status: DialogueStatus;
  application_open: number;
  is_published: number;
  display_order: number;
  created_at: number;
  updated_at: number;
  created_by: string;
  updated_by: string;
}

const PUBLIC_COLUMNS =
  "id, title, event_date, start_time, end_time, venue, address, description, capacity, status, application_open, display_order";
const ADMIN_COLUMNS = `${PUBLIC_COLUMNS}, is_published, created_at, updated_at, created_by, updated_by`;
const ORDER_BY = "ORDER BY display_order ASC, event_date ASC, start_time ASC, id ASC";
/** 一度に扱う件数の上限（過大な応答を防ぐ） */
const LIST_LIMIT = 500;

function toPublic(row: DialogueRow): DialogueEvent {
  return {
    id: row.id,
    title: row.title,
    eventDate: row.event_date,
    startTime: row.start_time,
    endTime: row.end_time ?? "",
    venue: row.venue,
    address: row.address ?? "",
    description: row.description ?? "",
    capacity: row.capacity ?? null,
    status: row.status,
    applicationOpen: row.application_open === 1,
    displayOrder: row.display_order,
  };
}

function toRecord(row: DialogueRow): DialogueEventRecord {
  return {
    ...toPublic(row),
    isPublished: row.is_published === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    createdBy: row.created_by,
    updatedBy: row.updated_by,
  };
}

/** 公開ページ用：削除されておらず「公開」になっている回（作成者などの管理用項目は読み出さない） */
export async function listPublicDialogueEvents(db: D1Database): Promise<DialogueEvent[]> {
  await ensureDialogueSchema(db);
  const { results } = await db
    .prepare(`SELECT ${PUBLIC_COLUMNS} FROM dialogue_events WHERE deleted_at IS NULL AND is_published = 1 ${ORDER_BY} LIMIT ${LIST_LIMIT}`)
    .all<DialogueRow>();
  return results.map(toPublic);
}

/** 執行部ポータル用：削除されていないすべての回 */
export async function listDialogueEvents(db: D1Database): Promise<DialogueEventRecord[]> {
  await ensureDialogueSchema(db);
  const { results } = await db
    .prepare(`SELECT ${ADMIN_COLUMNS} FROM dialogue_events WHERE deleted_at IS NULL ${ORDER_BY} LIMIT ${LIST_LIMIT}`)
    .all<DialogueRow>();
  return results.map(toRecord);
}

export async function getDialogueEvent(db: D1Database, id: number): Promise<DialogueEventRecord | null> {
  await ensureDialogueSchema(db);
  const row = await db
    .prepare(`SELECT ${ADMIN_COLUMNS} FROM dialogue_events WHERE id = ?1 AND deleted_at IS NULL`)
    .bind(id)
    .first<DialogueRow>();
  return row ? toRecord(row) : null;
}

// ---- 書き込み（すべて操作ログと同じトランザクションで記録する） ----

export type DialogueAction = "dialogue.create" | "dialogue.update" | "dialogue.status" | "dialogue.delete";

const AUDIT_TARGET = "dialogue_event";

const auditStatement = (db: D1Database, action: DialogueAction, targetId: number, actor: string, detail: Record<string, unknown>, now: number) =>
  sharedAuditStatement(db, action, AUDIT_TARGET, targetId, actor, detail, now);

/** サーバーログ（Cloudflareのログ）には操作の種類・ID・変更した項目名だけを出す（内容・メールアドレスは出さない） */
const logAction = (action: DialogueAction, id: number, detail: Record<string, unknown>) =>
  logStaffChange("staff-dialogue-change", action, id, detail);

const INPUT_COLUMNS: Record<keyof DialogueEventInput, string> = {
  title: "title",
  eventDate: "event_date",
  startTime: "start_time",
  endTime: "end_time",
  venue: "venue",
  address: "address",
  description: "description",
  capacity: "capacity",
  status: "status",
  applicationOpen: "application_open",
  isPublished: "is_published",
  displayOrder: "display_order",
};

function columnValues(input: DialogueEventInput): unknown[] {
  return [
    input.title,
    input.eventDate,
    input.startTime,
    input.endTime,
    input.venue,
    input.address,
    input.description,
    input.capacity,
    input.status,
    input.applicationOpen ? 1 : 0,
    input.isPublished ? 1 : 0,
    input.displayOrder,
  ];
}

export async function createDialogueEvent(db: D1Database, input: DialogueEventInput, actor: string): Promise<DialogueEventRecord> {
  await ensureDialogueSchema(db);
  const now = nowSeconds();
  const columns = Object.values(INPUT_COLUMNS);
  const detail = { status: input.status, isPublished: input.isPublished };
  const [inserted] = await db.batch<DialogueRow>([
    db
      .prepare(
        `INSERT INTO dialogue_events (${columns.join(", ")}, created_at, updated_at, created_by, updated_by)
         VALUES (${columns.map((_, i) => `?${i + 1}`).join(", ")}, ?13, ?13, ?14, ?14)
         RETURNING ${ADMIN_COLUMNS}`,
      )
      .bind(...columnValues(input), now, actor),
    // 直前のINSERTで採番されたIDを同じトランザクション内で記録する
    auditLastInsertStatement(db, "dialogue.create", AUDIT_TARGET, actor, detail, now),
  ]);
  const row = inserted?.results?.[0];
  if (!row) throw new Error("dialogue_insert_failed");
  logAction("dialogue.create", row.id, detail);
  return toRecord(row);
}

/** 編集。対象が無い（削除済みを含む）場合は null */
export async function updateDialogueEvent(db: D1Database, id: number, input: DialogueEventInput, actor: string): Promise<DialogueEventRecord | null> {
  const before = await getDialogueEvent(db, id);
  if (!before) return null;
  const now = nowSeconds();
  const changed = (Object.keys(INPUT_COLUMNS) as (keyof DialogueEventInput)[]).filter((key) => before[key] !== input[key]);
  const assignments = Object.values(INPUT_COLUMNS).map((column, i) => `${column} = ?${i + 1}`);
  const detail = { changed, ...(changed.includes("status") ? { from: before.status, to: input.status } : {}) };
  await db.batch([
    db
      .prepare(`UPDATE dialogue_events SET ${assignments.join(", ")}, updated_at = ?13, updated_by = ?14 WHERE id = ?15 AND deleted_at IS NULL`)
      .bind(...columnValues(input), now, actor, id),
    auditStatement(db, "dialogue.update", id, actor, detail, now),
  ]);
  logAction("dialogue.update", id, detail);
  return getDialogueEvent(db, id);
}

/** 受付状況の変更。対象が無い場合は null */
export async function changeDialogueStatus(
  db: D1Database,
  id: number,
  change: { status: DialogueStatus; applicationOpen?: boolean },
  actor: string,
): Promise<DialogueEventRecord | null> {
  const before = await getDialogueEvent(db, id);
  if (!before) return null;
  const now = nowSeconds();
  const applicationOpen = change.applicationOpen ?? before.applicationOpen;
  const detail = { from: before.status, to: change.status, applicationOpen };
  await db.batch([
    db
      .prepare("UPDATE dialogue_events SET status = ?1, application_open = ?2, updated_at = ?3, updated_by = ?4 WHERE id = ?5 AND deleted_at IS NULL")
      .bind(change.status, applicationOpen ? 1 : 0, now, actor, id),
    auditStatement(db, "dialogue.status", id, actor, detail, now),
  ]);
  logAction("dialogue.status", id, detail);
  return getDialogueEvent(db, id);
}

/** 削除（論理削除）。対象が無い場合は false */
export async function deleteDialogueEvent(db: D1Database, id: number, actor: string): Promise<boolean> {
  const before = await getDialogueEvent(db, id);
  if (!before) return false;
  const now = nowSeconds();
  await db.batch([
    db
      .prepare("UPDATE dialogue_events SET deleted_at = ?1, deleted_by = ?2, updated_at = ?1, updated_by = ?2 WHERE id = ?3 AND deleted_at IS NULL")
      .bind(now, actor, id),
    auditStatement(db, "dialogue.delete", id, actor, {}, now),
  ]);
  logAction("dialogue.delete", id, {});
  return true;
}
