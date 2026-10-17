// タスク（D1: tasks）の保存・読み出し・入力値検証です。執行部内だけで使い、公開ページ・公開APIには一切出しません。
//
// ・テーブルは最初のアクセス時に CREATE TABLE IF NOT EXISTS で作成する。同じ定義を migrations/0005_tasks.sql に置いている。
// ・進捗は0〜100の整数（画面では10%刻みで選ぶ）。完了と進捗は矛盾させない：
//     完了 … 進捗は必ず100%。完了にすると、直前の進捗を progress_before_completion に残し、完了日時・完了した人を記録する。
//     未完了 … 進捗は0〜90%（100%のままにはしない）。未完了に戻すと直前の進捗へ戻す（記録が無い・100%だった場合は90%）。
// ・担当者は自由記入（assignee）。将来メンバー管理を追加する場合は、assignee_member_id 列を追加して
//   validateTaskInput の担当者の検証と画面の入力欄（TaskForm.astro）を選択式に差し替える（既存の自由記入の値はそのまま表示できる）。
// ・削除は論理削除。作成・編集・完了・未完了に戻す・優先度変更・進捗変更・削除を staff_audit_log に記録する
//  （担当者・メモの内容は残さず、項目名だけを記録する）。

import { TASK_PRIORITIES, type TaskPriority, type TaskRecord } from "../src/types/tasks";
import { AUDIT_SCHEMA_SQL, auditLastInsertStatement, auditStatement, logStaffChange, nowSeconds } from "./auditLog";
import { boolValue, integerValue, isValidDate, textField } from "./validation";

export const TASKS_SCHEMA_SQL: readonly string[] = [
  `CREATE TABLE IF NOT EXISTS tasks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  assignee TEXT NOT NULL DEFAULT '',
  due_date TEXT NOT NULL DEFAULT '',
  priority TEXT NOT NULL DEFAULT 'medium' CHECK (priority IN ('high', 'medium', 'low')),
  progress INTEGER NOT NULL DEFAULT 0 CHECK (progress >= 0 AND progress <= 100),
  notes TEXT NOT NULL DEFAULT '',
  completed INTEGER NOT NULL DEFAULT 0 CHECK (completed IN (0, 1)),
  completed_at INTEGER,
  completed_by TEXT,
  progress_before_completion INTEGER CHECK (progress_before_completion IS NULL OR (progress_before_completion >= 0 AND progress_before_completion <= 100)),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  created_by TEXT NOT NULL,
  updated_by TEXT NOT NULL,
  deleted_at INTEGER,
  deleted_by TEXT
)`,
  "CREATE INDEX IF NOT EXISTS tasks_listing ON tasks (deleted_at, completed, due_date)",
  ...AUDIT_SCHEMA_SQL,
];

let schemaReady = new WeakSet<D1Database>();

/** テスト用：スキーマ作成済みの記録を消す */
export function resetTasksSchemaCache(): void {
  schemaReady = new WeakSet();
}

async function ensureTasksSchema(db: D1Database): Promise<void> {
  if (schemaReady.has(db)) return;
  await db.batch(TASKS_SCHEMA_SQL.map((sql) => db.prepare(sql)));
  schemaReady.add(db);
}

// ---- 入力値検証 ----

export const TASK_LIMITS = { title: 100, assignee: 50, notes: 2000 } as const;
/** 未完了のときの進捗の上限（100%は完了のときだけ） */
export const MAX_OPEN_PROGRESS = 90;

export interface TaskInput {
  title: string;
  assignee: string;
  dueDate: string;
  priority: TaskPriority;
  progress: number;
  notes: string;
  completed: boolean;
}

export type TaskFieldErrors = Partial<Record<keyof TaskInput, string>>;
export type TaskValidationResult<T> = { ok: true; value: T } | { ok: false; errors: TaskFieldErrors };

const isPriority = (value: unknown): value is TaskPriority => typeof value === "string" && (TASK_PRIORITIES as readonly string[]).includes(value);

/** 進捗（0〜100の整数）。解釈できない値は null */
function progressValue(value: unknown): number | null {
  const parsed = integerValue(value);
  return parsed === "invalid" || parsed === null || parsed < 0 || parsed > 100 ? null : parsed;
}

/** 新規登録・編集の入力値を検証する（サーバー側で必ず実行する） */
export function validateTaskInput(raw: unknown): TaskValidationResult<TaskInput> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { ok: false, errors: { title: "入力内容を読み取れませんでした。" } };
  const body = raw as Record<string, unknown>;
  const errors: TaskFieldErrors = {};

  const title = textField(body, "title", "タスク名", { required: true, max: TASK_LIMITS.title }, errors);
  // 担当者：自由記入（メンバー管理を追加したら、ここを選択肢の検証に差し替える）
  const assignee = textField(body, "assignee", "担当者", { required: false, max: TASK_LIMITS.assignee }, errors);
  const notes = textField(body, "notes", "メモ", { required: false, max: TASK_LIMITS.notes, multiline: true }, errors);

  const dueDate = typeof body.dueDate === "string" ? body.dueDate.trim() : body.dueDate === undefined || body.dueDate === null ? "" : null;
  if (dueDate === null || (dueDate !== "" && !isValidDate(dueDate))) errors.dueDate = "期限を正しく入力してください（例：2026-11-08。期限なしの場合は空欄）。";

  if (!isPriority(body.priority)) errors.priority = "優先度を選択してください。";

  const completed = boolValue(body.completed);
  if (completed === null) errors.completed = "完了／未完了の形式が正しくありません。";

  const progress = progressValue(body.progress);
  if (progress === null) errors.progress = "進捗は0〜100%の整数で指定してください。";
  else if (completed === false && progress > MAX_OPEN_PROGRESS) {
    errors.progress = `未完了のタスクの進捗は${MAX_OPEN_PROGRESS}%までです。100%にする場合は「完了」にしてください。`;
  }

  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return {
    ok: true,
    value: {
      title,
      assignee,
      dueDate: dueDate as string,
      priority: body.priority as TaskPriority,
      // 完了のタスクの進捗は必ず100%
      progress: completed ? 100 : (progress as number),
      notes,
      completed: completed as boolean,
    },
  };
}

/** 一覧画面からの変更（PATCH）：完了／未完了・優先度・進捗のうち、指定されたものだけを変える */
export interface TaskQuickChange {
  completed?: boolean;
  priority?: TaskPriority;
  progress?: number;
}

export function validateTaskQuickChange(raw: unknown): TaskValidationResult<TaskQuickChange> {
  const body = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const change: TaskQuickChange = {};
  const errors: TaskFieldErrors = {};
  if (body.completed !== undefined) {
    if (typeof body.completed === "boolean") change.completed = body.completed;
    else errors.completed = "完了／未完了の形式が正しくありません。";
  }
  if (body.priority !== undefined) {
    if (isPriority(body.priority)) change.priority = body.priority;
    else errors.priority = "優先度を選択してください。";
  }
  if (body.progress !== undefined) {
    const progress = progressValue(body.progress);
    if (progress === null) errors.progress = "進捗は0〜100%の整数で指定してください。";
    else change.progress = progress;
  }
  if (Object.keys(errors).length > 0) return { ok: false, errors };
  if (Object.keys(change).length === 0) return { ok: false, errors: { completed: "変更する内容を指定してください。" } };
  return { ok: true, value: change };
}

// ---- 読み出し ----

interface TaskRow {
  id: number;
  title: string;
  assignee: string;
  due_date: string;
  priority: TaskPriority;
  progress: number;
  notes: string;
  completed: number;
  completed_at: number | null;
  completed_by: string | null;
  progress_before_completion: number | null;
  created_at: number;
  updated_at: number;
  created_by: string;
  updated_by: string;
}

const COLUMNS =
  "id, title, assignee, due_date, priority, progress, notes, completed, completed_at, completed_by, progress_before_completion, created_at, updated_at, created_by, updated_by";
const LIST_LIMIT = 500;

function toRecord(row: TaskRow): TaskRecord {
  return {
    id: row.id,
    title: row.title,
    assignee: row.assignee,
    dueDate: row.due_date,
    priority: row.priority,
    progress: row.progress,
    notes: row.notes,
    completed: row.completed === 1,
    completedAt: row.completed_at ?? null,
    completedBy: row.completed_by ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    createdBy: row.created_by,
    updatedBy: row.updated_by,
  };
}

/** 削除されていないタスク（並び順は画面側の sortTasks で決める） */
export async function listTasks(db: D1Database): Promise<TaskRecord[]> {
  await ensureTasksSchema(db);
  const { results } = await db.prepare(`SELECT ${COLUMNS} FROM tasks WHERE deleted_at IS NULL ORDER BY id ASC LIMIT ${LIST_LIMIT}`).all<TaskRow>();
  return results.map(toRecord);
}

async function getTaskRow(db: D1Database, id: number): Promise<TaskRow | null> {
  await ensureTasksSchema(db);
  return db.prepare(`SELECT ${COLUMNS} FROM tasks WHERE id = ?1 AND deleted_at IS NULL`).bind(id).first<TaskRow>();
}

export async function getTask(db: D1Database, id: number): Promise<TaskRecord | null> {
  const row = await getTaskRow(db, id);
  return row ? toRecord(row) : null;
}

// ---- 書き込み（すべて操作ログと同じトランザクションで記録する） ----

export type TaskAction = "task.create" | "task.update" | "task.complete" | "task.reopen" | "task.priority" | "task.progress" | "task.delete";
const AUDIT_TARGET = "task";
const logAction = (action: TaskAction, id: number, detail: Record<string, unknown>) => logStaffChange("staff-task-change", action, id, detail);

/** 未完了に戻すときの進捗（完了直前の値。記録が無い・100%だった場合は90%） */
export const reopenedProgress = (before: number | null) => (before === null ? MAX_OPEN_PROGRESS : Math.min(before, MAX_OPEN_PROGRESS));

/** 変更後の状態（完了・進捗・完了日時など）を、矛盾が起きないように決める */
function nextState(row: TaskRow, desired: { completed: boolean; progress: number }, now: number, actor: string) {
  if (desired.completed) {
    const becameCompleted = row.completed !== 1;
    return {
      completed: 1,
      progress: 100,
      completedAt: becameCompleted ? now : row.completed_at,
      completedBy: becameCompleted ? actor : row.completed_by,
      progressBeforeCompletion: becameCompleted ? row.progress : row.progress_before_completion,
      transition: becameCompleted ? ("task.complete" as const) : null,
    };
  }
  const becameOpen = row.completed === 1;
  return {
    completed: 0,
    // 未完了に戻す操作では直前の進捗へ。未完了のまま進捗を指定した場合はその値（90%まで）
    progress: becameOpen && desired.progress === 100 ? reopenedProgress(row.progress_before_completion) : Math.min(desired.progress, MAX_OPEN_PROGRESS),
    completedAt: null,
    completedBy: null,
    progressBeforeCompletion: null,
    transition: becameOpen ? ("task.reopen" as const) : null,
  };
}

function stateStatement(db: D1Database, id: number, state: ReturnType<typeof nextState>, now: number, actor: string) {
  return db
    .prepare(
      `UPDATE tasks SET completed = ?1, progress = ?2, completed_at = ?3, completed_by = ?4, progress_before_completion = ?5,
         updated_at = ?6, updated_by = ?7 WHERE id = ?8 AND deleted_at IS NULL`,
    )
    .bind(state.completed, state.progress, state.completedAt, state.completedBy, state.progressBeforeCompletion, now, actor, id);
}

export async function createTask(db: D1Database, input: TaskInput, actor: string): Promise<TaskRecord> {
  await ensureTasksSchema(db);
  const now = nowSeconds();
  const detail = { priority: input.priority, completed: input.completed };
  const [inserted] = await db.batch<TaskRow>([
    db
      .prepare(
        `INSERT INTO tasks (title, assignee, due_date, priority, progress, notes, completed, completed_at, completed_by,
           created_at, updated_at, created_by, updated_by)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?10, ?11, ?11)
         RETURNING ${COLUMNS}`,
      )
      .bind(
        input.title,
        input.assignee,
        input.dueDate,
        input.priority,
        input.progress,
        input.notes,
        input.completed ? 1 : 0,
        input.completed ? now : null,
        input.completed ? actor : null,
        now,
        actor,
      ),
    auditLastInsertStatement(db, "task.create", AUDIT_TARGET, actor, detail, now),
  ]);
  const row = inserted?.results?.[0];
  if (!row) throw new Error("task_insert_failed");
  logAction("task.create", row.id, detail);
  return toRecord(row);
}

/** 編集。対象が無い（削除済みを含む）場合は null */
export async function updateTask(db: D1Database, id: number, input: TaskInput, actor: string): Promise<TaskRecord | null> {
  const row = await getTaskRow(db, id);
  if (!row) return null;
  const before = toRecord(row);
  const now = nowSeconds();
  const state = nextState(row, input, now, actor);
  const changed: string[] = (["title", "assignee", "dueDate", "priority", "notes", "completed"] as const).filter((key) => before[key] !== input[key]);
  if (before.progress !== state.progress) changed.push("progress");
  const statements = [
    db
      .prepare("UPDATE tasks SET title = ?1, assignee = ?2, due_date = ?3, priority = ?4, notes = ?5 WHERE id = ?6 AND deleted_at IS NULL")
      .bind(input.title, input.assignee, input.dueDate, input.priority, input.notes, id),
    stateStatement(db, id, state, now, actor),
    auditStatement(db, "task.update", AUDIT_TARGET, id, actor, { changed }, now),
  ];
  if (state.transition) statements.push(auditStatement(db, state.transition, AUDIT_TARGET, id, actor, {}, now));
  await db.batch(statements);
  logAction("task.update", id, { changed });
  return getTask(db, id);
}

/** 一覧画面からの変更（完了／未完了・優先度・進捗）。対象が無い場合は null */
export async function quickChangeTask(db: D1Database, id: number, change: TaskQuickChange, actor: string): Promise<TaskRecord | null> {
  const row = await getTaskRow(db, id);
  if (!row) return null;
  const now = nowSeconds();
  const statements: D1PreparedStatement[] = [];
  const actions: { action: TaskAction; detail: Record<string, unknown> }[] = [];

  if (change.priority !== undefined && change.priority !== row.priority) {
    statements.push(db.prepare("UPDATE tasks SET priority = ?1, updated_at = ?2, updated_by = ?3 WHERE id = ?4 AND deleted_at IS NULL").bind(change.priority, now, actor, id));
    actions.push({ action: "task.priority", detail: { from: row.priority, to: change.priority } });
  }

  // 進捗だけを指定した場合：100%なら完了に、完了済みのタスクで100%未満なら未完了に戻す（矛盾させない）
  let completed = change.completed ?? row.completed === 1;
  if (change.completed === undefined && change.progress !== undefined) completed = change.progress === 100;
  const desiredProgress = change.progress ?? (completed ? 100 : row.completed === 1 ? 100 : row.progress);
  const state = nextState(row, { completed, progress: desiredProgress }, now, actor);
  if (state.completed !== row.completed || state.progress !== row.progress) {
    statements.push(stateStatement(db, id, state, now, actor));
    if (state.transition) actions.push({ action: state.transition, detail: {} });
    if (state.progress !== row.progress) actions.push({ action: "task.progress", detail: { from: row.progress, to: state.progress } });
  }

  if (statements.length === 0) return toRecord(row);
  for (const { action, detail } of actions) statements.push(auditStatement(db, action, AUDIT_TARGET, id, actor, detail, now));
  await db.batch(statements);
  for (const { action, detail } of actions) logAction(action, id, detail);
  return getTask(db, id);
}

/** 削除（論理削除）。対象が無い場合は false */
export async function deleteTask(db: D1Database, id: number, actor: string): Promise<boolean> {
  const row = await getTaskRow(db, id);
  if (!row) return false;
  const now = nowSeconds();
  await db.batch([
    db.prepare("UPDATE tasks SET deleted_at = ?1, deleted_by = ?2, updated_at = ?1, updated_by = ?2 WHERE id = ?3 AND deleted_at IS NULL").bind(now, actor, id),
    auditStatement(db, "task.delete", AUDIT_TARGET, id, actor, {}, now),
  ]);
  logAction("task.delete", id, {});
  return true;
}
