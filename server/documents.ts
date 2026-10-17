// 資料（D1: staff_documents）の保存・読み出し・入力値検証です。執行部内部用で、公開ページ・公開APIには一切出しません。
//
// ・保存するのは資料のURL（Google Drive・Docs・Sheets・PDF など）と説明だけ。サイト側から資料の中身を取得・公開することはない。
//   資料を見られる人は、Google Drive 側の共有設定で決まる。
// ・URLは https:// のみ受け付ける（javascript:・data:・file:・http: などは拒否）。
// ・資料の種類はURLから自動判定する（判定できない場合は「その他」。登録時に手動で選ぶこともできる）。
// ・カテゴリー・種類はアプリ側で検証する（D1には値の制約を設けず、カテゴリーの追加をコードの変更だけで行えるようにする）。
// ・テーブルは最初のアクセス時に CREATE TABLE IF NOT EXISTS で作成する。同じ定義を migrations/0007_staff_documents.sql に置いている。
// ・削除は論理削除。追加・編集・ピン留め・削除を staff_audit_log に記録する（URL・説明の内容は記録しない）。

import {
  DOCUMENT_CATEGORIES,
  DOCUMENT_TYPES,
  type DocumentCategory,
  type DocumentRecord,
  type DocumentType,
} from "../src/types/documents";
import { AUDIT_SCHEMA_SQL, auditLastInsertStatement, auditStatement, logStaffChange, nowSeconds } from "./auditLog";
import { detectDocumentType } from "../src/utils/documentType";
import { boolValue, FORBIDDEN_CHARS, integerValue, textField } from "./validation";

export const DOCUMENTS_SCHEMA_SQL: readonly string[] = [
  `CREATE TABLE IF NOT EXISTS staff_documents (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  category TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  url TEXT NOT NULL,
  document_type TEXT NOT NULL,
  pinned INTEGER NOT NULL DEFAULT 0 CHECK (pinned IN (0, 1)),
  display_order INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  created_by TEXT NOT NULL,
  updated_by TEXT NOT NULL,
  deleted_at INTEGER,
  deleted_by TEXT
)`,
  "CREATE INDEX IF NOT EXISTS staff_documents_listing ON staff_documents (deleted_at, pinned, display_order)",
  ...AUDIT_SCHEMA_SQL,
];

let schemaReady = new WeakSet<D1Database>();

/** テスト用：スキーマ作成済みの記録を消す */
export function resetDocumentsSchemaCache(): void {
  schemaReady = new WeakSet();
}

async function ensureDocumentsSchema(db: D1Database): Promise<void> {
  if (schemaReady.has(db)) return;
  await db.batch(DOCUMENTS_SCHEMA_SQL.map((sql) => db.prepare(sql)));
  schemaReady.add(db);
}

// ---- URL ----

export const DOCUMENT_LIMITS = { title: 100, description: 1000, url: 2000, displayOrderAbs: 9999 } as const;

/** URLを検証する。https:// で、ホスト名があり、ID・パスワードを含まないものだけ。正規化したURLを返す（不可なら null） */
export function validateDocumentUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (trimmed === "" || trimmed.length > DOCUMENT_LIMITS.url || /\s/.test(trimmed) || FORBIDDEN_CHARS.test(trimmed)) return null;
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" || !url.hostname || url.username || url.password) return null;
  return url.href;
}

export { detectDocumentType };

// ---- 入力値検証 ----

export interface DocumentInput {
  title: string;
  category: DocumentCategory;
  description: string;
  url: string;
  documentType: DocumentType;
  pinned: boolean;
  displayOrder: number;
}

export type DocumentFieldErrors = Partial<Record<keyof DocumentInput, string>>;
export type DocumentValidationResult<T> = { ok: true; value: T } | { ok: false; errors: DocumentFieldErrors };

const oneOf = <T extends string>(values: readonly T[], value: unknown): value is T => typeof value === "string" && (values as readonly string[]).includes(value);

/** 新規登録・編集の入力値を検証する（サーバー側で必ず実行する）。documentType が "auto"・未指定ならURLから判定する */
export function validateDocumentInput(raw: unknown): DocumentValidationResult<DocumentInput> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { ok: false, errors: { title: "入力内容を読み取れませんでした。" } };
  const body = raw as Record<string, unknown>;
  const errors: DocumentFieldErrors = {};

  const title = textField(body, "title", "タイトル", { required: true, max: DOCUMENT_LIMITS.title }, errors);
  const description = textField(body, "description", "説明", { required: false, max: DOCUMENT_LIMITS.description, multiline: true }, errors);
  if (!oneOf(DOCUMENT_CATEGORIES, body.category)) errors.category = "カテゴリーを選択してください。";

  const url = validateDocumentUrl(body.url);
  if (url === null) errors.url = "URLは「https://」で始まる資料のURLを入力してください（javascript: など他の形式は登録できません）。";

  let documentType: DocumentType = "other";
  if (body.documentType === undefined || body.documentType === null || body.documentType === "" || body.documentType === "auto") {
    if (url) documentType = detectDocumentType(url);
  } else if (oneOf(DOCUMENT_TYPES, body.documentType)) {
    documentType = body.documentType;
  } else {
    errors.documentType = "資料の種類を選択してください。";
  }

  const pinned = boolValue(body.pinned);
  if (pinned === null) errors.pinned = "ピン留めの形式が正しくありません。";

  const displayOrder = integerValue(body.displayOrder);
  if (displayOrder === "invalid" || (displayOrder !== null && Math.abs(displayOrder) > DOCUMENT_LIMITS.displayOrderAbs)) {
    errors.displayOrder = `表示順は-${DOCUMENT_LIMITS.displayOrderAbs}〜${DOCUMENT_LIMITS.displayOrderAbs}の整数で入力してください。`;
  }

  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return {
    ok: true,
    value: {
      title,
      category: body.category as DocumentCategory,
      description,
      url: url as string,
      documentType,
      pinned: pinned as boolean,
      displayOrder: (displayOrder as number | null) ?? 0,
    },
  };
}

/** 一覧画面からのピン留めの切り替え（PATCH） */
export function validatePinChange(raw: unknown): DocumentValidationResult<{ pinned: boolean }> {
  const body = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  if (typeof body.pinned !== "boolean") return { ok: false, errors: { pinned: "ピン留めを指定してください。" } };
  return { ok: true, value: { pinned: body.pinned } };
}

// ---- 読み出し ----

interface DocumentRow {
  id: number;
  title: string;
  category: DocumentCategory;
  description: string;
  url: string;
  document_type: DocumentType;
  pinned: number;
  display_order: number;
  created_at: number;
  updated_at: number;
  created_by: string;
  updated_by: string;
}

const COLUMNS = "id, title, category, description, url, document_type, pinned, display_order, created_at, updated_at, created_by, updated_by";
const LIST_LIMIT = 500;

function toRecord(row: DocumentRow): DocumentRecord {
  return {
    id: row.id,
    title: row.title,
    // 将来カテゴリー・種類を減らした場合でも表示が壊れないよう、知らない値は「その他」として扱う
    category: oneOf(DOCUMENT_CATEGORIES, row.category) ? row.category : "other",
    description: row.description,
    url: row.url,
    documentType: oneOf(DOCUMENT_TYPES, row.document_type) ? row.document_type : "other",
    pinned: row.pinned === 1,
    displayOrder: row.display_order,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    createdBy: row.created_by,
    updatedBy: row.updated_by,
  };
}

/** 削除されていない資料（ピン留め → 表示順 → 更新の新しい順） */
export async function listDocuments(db: D1Database): Promise<DocumentRecord[]> {
  await ensureDocumentsSchema(db);
  const { results } = await db
    .prepare(`SELECT ${COLUMNS} FROM staff_documents WHERE deleted_at IS NULL ORDER BY pinned DESC, display_order ASC, updated_at DESC, id DESC LIMIT ${LIST_LIMIT}`)
    .all<DocumentRow>();
  return results.map(toRecord);
}

export async function getDocument(db: D1Database, id: number): Promise<DocumentRecord | null> {
  await ensureDocumentsSchema(db);
  const row = await db.prepare(`SELECT ${COLUMNS} FROM staff_documents WHERE id = ?1 AND deleted_at IS NULL`).bind(id).first<DocumentRow>();
  return row ? toRecord(row) : null;
}

// ---- 書き込み（すべて操作ログと同じトランザクションで記録する） ----

export type DocumentAction = "document.create" | "document.update" | "document.pin" | "document.delete";
const AUDIT_TARGET = "document";
const logAction = (action: DocumentAction, id: number, detail: Record<string, unknown>) => logStaffChange("staff-document-change", action, id, detail);

const INPUT_KEYS = ["title", "category", "description", "url", "documentType", "pinned", "displayOrder"] as const;
const columnValues = (input: DocumentInput) => [input.title, input.category, input.description, input.url, input.documentType, input.pinned ? 1 : 0, input.displayOrder];

export async function createDocument(db: D1Database, input: DocumentInput, actor: string): Promise<DocumentRecord> {
  await ensureDocumentsSchema(db);
  const now = nowSeconds();
  const detail = { category: input.category, documentType: input.documentType, pinned: input.pinned };
  const [inserted] = await db.batch<DocumentRow>([
    db
      .prepare(
        `INSERT INTO staff_documents (title, category, description, url, document_type, pinned, display_order, created_at, updated_at, created_by, updated_by)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?8, ?9, ?9)
         RETURNING ${COLUMNS}`,
      )
      .bind(...columnValues(input), now, actor),
    auditLastInsertStatement(db, "document.create", AUDIT_TARGET, actor, detail, now),
  ]);
  const row = inserted?.results?.[0];
  if (!row) throw new Error("document_insert_failed");
  logAction("document.create", row.id, detail);
  return toRecord(row);
}

/** 編集。対象が無い（削除済みを含む）場合は null */
export async function updateDocument(db: D1Database, id: number, input: DocumentInput, actor: string): Promise<DocumentRecord | null> {
  const before = await getDocument(db, id);
  if (!before) return null;
  const now = nowSeconds();
  const changed = INPUT_KEYS.filter((key) => before[key] !== input[key]);
  await db.batch([
    db
      .prepare(
        `UPDATE staff_documents SET title = ?1, category = ?2, description = ?3, url = ?4, document_type = ?5, pinned = ?6, display_order = ?7,
           updated_at = ?8, updated_by = ?9 WHERE id = ?10 AND deleted_at IS NULL`,
      )
      .bind(...columnValues(input), now, actor, id),
    auditStatement(db, "document.update", AUDIT_TARGET, id, actor, { changed }, now),
  ]);
  logAction("document.update", id, { changed });
  return getDocument(db, id);
}

/** ピン留めの切り替え。対象が無い場合は null */
export async function setDocumentPinned(db: D1Database, id: number, pinned: boolean, actor: string): Promise<DocumentRecord | null> {
  const before = await getDocument(db, id);
  if (!before) return null;
  if (before.pinned === pinned) return before;
  const now = nowSeconds();
  await db.batch([
    db.prepare("UPDATE staff_documents SET pinned = ?1, updated_at = ?2, updated_by = ?3 WHERE id = ?4 AND deleted_at IS NULL").bind(pinned ? 1 : 0, now, actor, id),
    auditStatement(db, "document.pin", AUDIT_TARGET, id, actor, { pinned }, now),
  ]);
  logAction("document.pin", id, { pinned });
  return getDocument(db, id);
}

/** 削除（論理削除）。対象が無い場合は false */
export async function deleteDocument(db: D1Database, id: number, actor: string): Promise<boolean> {
  const before = await getDocument(db, id);
  if (!before) return false;
  const now = nowSeconds();
  await db.batch([
    db.prepare("UPDATE staff_documents SET deleted_at = ?1, deleted_by = ?2, updated_at = ?1, updated_by = ?2 WHERE id = ?3 AND deleted_at IS NULL").bind(now, actor, id),
    auditStatement(db, "document.delete", AUDIT_TARGET, id, actor, {}, now),
  ]);
  logAction("document.delete", id, {});
  return true;
}
