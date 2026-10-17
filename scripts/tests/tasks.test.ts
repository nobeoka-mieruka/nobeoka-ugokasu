// タスク管理（/staff/tasks/・/staff/api/tasks）のテストです。
// D1はNode標準のSQLite（node:sqlite）で再現します。実際のGoogle・Cloudflareへは一切アクセスしません。
//
// 実行: npm run test:tasks

import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { FakeD1 } from "./helpers/fakeD1";
import type { StaffAuthEnv } from "../../server/env";
import { createSession, resetSchemaCache } from "../../server/staffAuth";
import { TASKS_SCHEMA_SQL, resetTasksSchemaCache, validateTaskInput, validateTaskQuickChange } from "../../server/tasks";
import { listPublicEvents, resetEventsSchemaCache } from "../../server/events";
import { listPublicNews, resetNewsSchemaCache } from "../../server/newsItems";
import { resetDialogueSchemaCache } from "../../server/dialogueEvents";
import { onRequest as staffMiddleware } from "../../functions/staff/_middleware";
import * as listApi from "../../functions/staff/api/tasks/index";
import * as itemApi from "../../functions/staff/api/tasks/[id]";
import { onRequestGet as editPage } from "../../functions/staff/tasks/[id]/edit";
import type { TaskRecord } from "../../src/types/tasks";
import { DUE_STATE_LABELS, dueState, sortTasks } from "../../src/utils/taskOrder";

(globalThis as Record<string, unknown>).HTMLRewriter = class {
  on() {
    return this;
  }
  transform(res: Response) {
    return res;
  }
};

const logLines: string[] = [];
const realLog = console.log;
console.log = (...args: unknown[]) => {
  const line = args.map(String).join(" ");
  if (line.startsWith("{")) logLines.push(line);
  else realLog(...args);
};

const ORIGIN = "https://nobeoka-ugokasu.pages.dev";
const STAFF = "staff@example.com";
const makeEnv = (db = new FakeD1()) =>
  ({
    STAFF_DB: db as unknown as D1Database,
    GOOGLE_CLIENT_ID: "test-client-id.apps.googleusercontent.com",
    GOOGLE_CLIENT_SECRET: "test-client-secret",
    STAFF_ALLOWED_EMAILS: STAFF,
  }) satisfies StaffAuthEnv;
type Env = ReturnType<typeof makeEnv>;
type Auth = { cookie: string; csrf: string };
const fakeDb = (env: Env) => env.STAFF_DB as unknown as FakeD1;

const realNow = Date.now;
let timeOffsetMs = 0;
Date.now = () => realNow() + timeOffsetMs;

async function loginAs(env: Env): Promise<Auth> {
  const sessionId = await createSession(env.STAFF_DB, STAFF);
  const csrf = (await fakeDb(env).prepare("SELECT csrf_token FROM staff_sessions").first<{ csrf_token: string }>())!.csrf_token;
  return { cookie: `staff_session=${sessionId}`, csrf };
}

type Handler = (ctx: never) => Response | Promise<Response>;
const PAGE_HTML = "<html><body><h1>タスクの管理</h1></body></html>";

function route(method: string, pathname: string): { handler: Handler | null; params: Record<string, string> } {
  if (pathname === "/staff/api/tasks") {
    return { handler: (method === "GET" ? listApi.onRequestGet : method === "POST" ? listApi.onRequestPost : null) as Handler | null, params: {} };
  }
  const item = /^\/staff\/api\/tasks\/([^/]+)$/.exec(pathname);
  if (item) {
    const handlers: Record<string, unknown> = { GET: itemApi.onRequestGet, PUT: itemApi.onRequestPut, PATCH: itemApi.onRequestPatch, DELETE: itemApi.onRequestDelete };
    return { handler: (handlers[method] ?? null) as Handler | null, params: { id: item[1] } };
  }
  const edit = /^\/staff\/tasks\/([^/]+)\/edit\/?$/.exec(pathname);
  if (edit) return { handler: editPage as Handler, params: { id: edit[1] } };
  return { handler: null, params: {} };
}

interface CallOptions {
  method?: string;
  body?: unknown;
  rawBody?: string;
  cookie?: string;
  csrf?: string | null;
  origin?: string | null;
}

let assetsRequested: string[] = [];

async function call(env: Env, pathname: string, options: CallOptions = {}) {
  const method = options.method ?? "GET";
  const headers = new Headers({ "CF-Connecting-IP": "203.0.113.10" });
  if (options.cookie) headers.set("Cookie", options.cookie);
  if (options.csrf) headers.set("X-CSRF-Token", options.csrf);
  if (method !== "GET") {
    if (options.origin !== null) headers.set("Origin", options.origin ?? ORIGIN);
    headers.set("Content-Type", "application/json");
  }
  const body = options.rawBody ?? (options.body === undefined ? undefined : JSON.stringify(options.body));
  const request = new Request(`${ORIGIN}${pathname}`, { method, headers, body });
  const { handler, params } = route(method, new URL(request.url).pathname);
  const data: Record<string, unknown> = {};
  let reachedHandler = false;
  const fullEnv = {
    ...env,
    ASSETS: {
      fetch: async (input: RequestInfo | URL) => {
        assetsRequested.push(new URL(String(input)).pathname);
        return new Response(PAGE_HTML, { headers: { "Content-Type": "text/html; charset=utf-8" } });
      },
    },
  };
  const ctx = {
    request,
    env: fullEnv,
    data,
    params,
    next: async () => {
      reachedHandler = true;
      if (!handler) return new Response(PAGE_HTML, { headers: { "Content-Type": "text/html; charset=utf-8" } });
      return handler({ request, env: fullEnv, data, params } as never);
    },
  };
  const res = await staffMiddleware(ctx as unknown as EventContext<StaffAuthEnv, string, Record<string, unknown>>);
  const text = await res.text();
  let json: Record<string, unknown> | null = null;
  try {
    json = JSON.parse(text);
  } catch {
    json = null;
  }
  return { res, text, json, reachedHandler };
}

const SECRET_NOTE = "メモ：会場の鍵は事務局が保管";
const validInput = {
  title: "チラシの印刷を手配する",
  assignee: "盛武",
  dueDate: "2099-11-01",
  priority: "medium",
  progress: "30",
  notes: SECRET_NOTE,
  completed: false,
};

async function createTask(env: Env, auth: Auth, overrides: Record<string, unknown> = {}) {
  const r = await call(env, "/staff/api/tasks", { method: "POST", body: { ...validInput, ...overrides }, ...auth });
  assert.equal(r.res.status, 201, r.text);
  return (r.json as { task: TaskRecord }).task;
}

const patch = (env: Env, auth: Auth, id: number, body: unknown) => call(env, `/staff/api/tasks/${id}`, { method: "PATCH", body, ...auth });
const put = (env: Env, auth: Auth, id: number, body: Record<string, unknown>) => call(env, `/staff/api/tasks/${id}`, { method: "PUT", body: { ...validInput, ...body }, ...auth });
const taskOf = (r: { json: Record<string, unknown> | null }) => (r.json as { task: TaskRecord }).task;
const auditActions = async (env: Env) =>
  (await fakeDb(env).prepare("SELECT action FROM staff_audit_log WHERE target_type = 'task' ORDER BY id").all<{ action: string }>()).results.map((r) => r.action);

let passed = 0;
async function test(name: string, fn: () => Promise<void> | void) {
  timeOffsetMs = 0;
  assetsRequested = [];
  resetSchemaCache();
  resetDialogueSchemaCache();
  resetNewsSchemaCache();
  resetEventsSchemaCache();
  resetTasksSchemaCache();
  try {
    await fn();
    passed++;
    realLog(`✓ ${name}`);
  } catch (err) {
    console.error(`✗ ${name}`);
    throw err;
  }
}

// =========================================================
await test("1. 未ログインでは /staff/tasks/ に入れず、APIも内容を返さない", async () => {
  const env = makeEnv();
  for (const p of ["/staff/tasks/", "/staff/tasks/new/", "/staff/tasks/1/edit/"]) {
    const r = await call(env, p);
    assert.equal(r.res.status, 302, p);
    assert.equal(r.res.headers.get("Location"), "/staff/login/", p);
    assert.equal(r.reachedHandler, false, p);
  }
  for (const [method, p] of [["GET", "/staff/api/tasks"], ["POST", "/staff/api/tasks"], ["PATCH", "/staff/api/tasks/1"], ["DELETE", "/staff/api/tasks/1"]]) {
    const r = await call(env, p, { method, body: method === "GET" ? undefined : validInput });
    assert.equal(r.res.status, 401, `${method} ${p}`);
  }
});

await test("2. 新規登録でき（優先度の初期値は中）、作成者と操作ログが記録される（ログにメモ・担当者・メールアドレスを出さない）", async () => {
  const env = makeEnv();
  const auth = await loginAs(env);
  logLines.length = 0;
  const task = await createTask(env, auth);
  assert.equal(task.title, "チラシの印刷を手配する");
  assert.equal(task.assignee, "盛武");
  assert.equal(task.progress, 30);
  assert.equal(task.completed, false);
  assert.equal(task.createdBy, STAFF);
  assert.deepEqual(await auditActions(env), ["task.create"]);
  const audit = JSON.stringify((await fakeDb(env).prepare("SELECT detail FROM staff_audit_log").all()).results);
  for (const secret of [SECRET_NOTE, "盛武"]) {
    assert.ok(!audit.includes(secret), secret);
    assert.ok(!logLines.join("\n").includes(secret), secret);
  }
  assert.ok(!logLines.join("\n").includes("example.com"));
  assert.ok(readFileSync(new URL("../../src/components/staff/TaskForm.astro", import.meta.url), "utf8").includes('selected={priority === "medium"}'), "画面の優先度の初期値は中");
  const page = await call(env, "/staff/tasks/", auth);
  assert.equal(page.res.headers.get("X-Robots-Tag"), "noindex, nofollow");
});

await test("3. 編集でき、担当者・期限・優先度の変更と updated_at・updated_by が記録される", async () => {
  const env = makeEnv();
  const auth = await loginAs(env);
  const task = await createTask(env, auth);
  timeOffsetMs = 60_000;
  const r = await put(env, auth, task.id, { assignee: "事務局", dueDate: "2099-12-24", priority: "high", progress: "50" });
  assert.equal(r.res.status, 200, r.text);
  const updated = taskOf(r);
  assert.deepEqual([updated.assignee, updated.dueDate, updated.priority, updated.progress], ["事務局", "2099-12-24", "high", 50]);
  assert.ok(updated.updatedAt >= task.updatedAt + 60);
  const detail = await fakeDb(env).prepare("SELECT detail FROM staff_audit_log WHERE action = 'task.update'").first<{ detail: string }>();
  assert.deepEqual(JSON.parse(detail!.detail).changed, ["assignee", "dueDate", "priority", "progress"]);
  // 期限を外す（任意入力）
  assert.equal(taskOf(await put(env, auth, task.id, { dueDate: "" })).dueDate, "");
  const edit = await call(env, `/staff/tasks/${task.id}/edit/`, auth);
  assert.equal(edit.res.status, 200);
  assert.deepEqual(assetsRequested, ["/staff/tasks/edit/"]);
  assert.equal((await call(env, "/staff/tasks/abc/edit/", auth)).res.status, 404);
});

await test("4. 進捗は0〜100の整数だけ（画面は10%刻み）。未完了で100%・不正値は拒否", async () => {
  for (const progress of [0, 10, 25, 90, "40"]) assert.ok(validateTaskInput({ ...validInput, progress }).ok, String(progress));
  for (const progress of [-1, 101, 2.5, "abc", "", null, "1e2"]) {
    const r = validateTaskInput({ ...validInput, progress });
    assert.equal(r.ok, false, String(progress));
    if (!r.ok) assert.ok(r.errors.progress, String(progress));
  }
  const open100 = validateTaskInput({ ...validInput, progress: 100, completed: false });
  assert.equal(open100.ok, false, "未完了のまま100%にはできない");
  const done = validateTaskInput({ ...validInput, progress: 40, completed: true });
  assert.ok(done.ok && done.value.progress === 100, "完了なら進捗は100%");
  for (const body of [{ progress: 150 }, { progress: -5 }, { priority: "urgent" }, { completed: "yes" }, {}]) {
    assert.equal(validateTaskQuickChange(body).ok, false, JSON.stringify(body));
  }
});

await test("5. 完了にすると進捗100%・完了日時・完了した人を記録し、未完了に戻すと直前の進捗へ戻る", async () => {
  const env = makeEnv();
  const auth = await loginAs(env);
  const task = await createTask(env, auth, { progress: "60" });
  timeOffsetMs = 30_000;
  let r = await patch(env, auth, task.id, { completed: true });
  assert.equal(r.res.status, 200);
  let t = taskOf(r);
  assert.equal(t.completed, true);
  assert.equal(t.progress, 100);
  assert.equal(t.completedBy, STAFF);
  assert.ok(t.completedAt! >= task.createdAt + 30);
  r = await patch(env, auth, task.id, { completed: false });
  t = taskOf(r);
  assert.equal(t.completed, false);
  assert.equal(t.progress, 60, "直前の進捗（60%）へ戻る");
  assert.equal(t.completedAt, null);
  assert.equal(t.completedBy, null);
  // 直前が90%以上（例：100%を直接指定して完了）なら90%へ
  r = await patch(env, auth, task.id, { progress: 100 });
  t = taskOf(r);
  assert.equal(t.completed, true, "進捗100%にすると完了になる");
  t = taskOf(await patch(env, auth, task.id, { completed: false }));
  assert.equal(t.progress, 60, "完了直前の60%に戻る");
  // 完了済みで進捗を下げると未完了に戻る（矛盾させない）
  await patch(env, auth, task.id, { completed: true });
  t = taskOf(await patch(env, auth, task.id, { progress: 40 }));
  assert.deepEqual([t.completed, t.progress], [false, 40]);
  // 編集画面から完了→未完了（進捗90%以下を指定）
  t = taskOf(await put(env, auth, task.id, { completed: true, progress: "100" }));
  assert.deepEqual([t.completed, t.progress], [true, 100]);
  t = taskOf(await put(env, auth, task.id, { completed: false, progress: "80" }));
  assert.deepEqual([t.completed, t.progress, t.completedAt], [false, 80, null]);
  const actions = await auditActions(env);
  assert.ok(actions.filter((a) => a === "task.complete").length >= 4);
  assert.ok(actions.filter((a) => a === "task.reopen").length >= 4);
  // 一度も完了の記録が無いまま100%だった値を戻す場合は90%（reopenedProgress）
  const { reopenedProgress } = await import("../../server/tasks");
  assert.deepEqual([reopenedProgress(null), reopenedProgress(100), reopenedProgress(30)], [90, 90, 30]);
});

await test("6. 一覧から優先度・進捗を変更でき、操作ログに残る", async () => {
  const env = makeEnv();
  const auth = await loginAs(env);
  const task = await createTask(env, auth);
  let t = taskOf(await patch(env, auth, task.id, { priority: "high" }));
  assert.equal(t.priority, "high");
  t = taskOf(await patch(env, auth, task.id, { progress: 70, priority: "low" }));
  assert.deepEqual([t.priority, t.progress, t.completed], ["low", 70, false]);
  assert.deepEqual(await auditActions(env), ["task.create", "task.priority", "task.priority", "task.progress"]);
  assert.equal((await patch(env, auth, task.id, { priority: "urgent" })).res.status, 422);
  assert.equal((await patch(env, auth, task.id, { progress: 101 })).res.status, 422);
});

await test("7. 削除（論理削除）すると一覧から消え、行は残る", async () => {
  const env = makeEnv();
  const auth = await loginAs(env);
  const task = await createTask(env, auth);
  assert.equal((await call(env, `/staff/api/tasks/${task.id}`, { method: "DELETE", ...auth })).res.status, 200);
  const list = await call(env, "/staff/api/tasks", auth);
  assert.deepEqual((list.json as { tasks: unknown[] }).tasks, []);
  const row = await fakeDb(env).prepare("SELECT deleted_by FROM tasks WHERE id = ?1").bind(task.id).first<{ deleted_by: string }>();
  assert.equal(row!.deleted_by, STAFF);
  assert.equal((await call(env, `/staff/api/tasks/${task.id}`, { method: "DELETE", ...auth })).res.status, 404);
  assert.equal((await auditActions(env)).at(-1), "task.delete");
});

await test("8. CSRFトークン無し・不一致・別サイトからの更新要求は403", async () => {
  const env = makeEnv();
  const auth = await loginAs(env);
  const task = await createTask(env, auth);
  const attempts: [string, CallOptions][] = [
    ["/staff/api/tasks", { method: "POST", body: validInput, cookie: auth.cookie }],
    ["/staff/api/tasks", { method: "POST", body: validInput, ...auth, origin: "https://evil.example.com" }],
    [`/staff/api/tasks/${task.id}`, { method: "PUT", body: validInput, cookie: auth.cookie, csrf: "wrong" }],
    [`/staff/api/tasks/${task.id}`, { method: "PATCH", body: { completed: true }, ...auth, origin: null }],
    [`/staff/api/tasks/${task.id}`, { method: "DELETE", cookie: auth.cookie }],
  ];
  for (const [p, options] of attempts) {
    const r = await call(env, p, options);
    assert.equal(r.res.status, 403, `${options.method} ${p}`);
    assert.equal(r.reachedHandler, false);
  }
  const list = (await call(env, "/staff/api/tasks", auth)).json as { tasks: TaskRecord[] };
  assert.deepEqual(list.tasks.map((t) => [t.completed, t.progress]), [[false, 30]], "拒否された要求では何も変わらない");
});

await test("9. 入力値検証（タスク名・担当者50文字・期限・優先度・メモ上限・過大な本文・不正なID）", async () => {
  const cases: [Record<string, unknown>, string][] = [
    [{ title: "" }, "title"],
    [{ title: "あ".repeat(101) }, "title"],
    [{ assignee: "あ".repeat(51) }, "assignee"],
    [{ assignee: ["盛武"] }, "assignee"],
    [{ dueDate: "2026-02-30" }, "dueDate"],
    [{ dueDate: "来週" }, "dueDate"],
    [{ priority: "urgent" }, "priority"],
    [{ priority: "高" }, "priority"],
    [{ notes: "x".repeat(2001) }, "notes"],
    [{ title: "タスク\u202Eです" }, "title"],
    [{ completed: "maybe" }, "completed"],
  ];
  for (const [override, field] of cases) {
    const r = validateTaskInput({ ...validInput, ...override });
    assert.equal(r.ok, false, JSON.stringify(override));
    if (!r.ok) assert.ok(r.errors[field as keyof typeof r.errors], `${JSON.stringify(override)} → ${field}`);
  }
  for (const assignee of ["盛武", "福富", "事務局", "広報担当", "", "あ".repeat(50)]) assert.ok(validateTaskInput({ ...validInput, assignee }).ok, assignee);
  const env = makeEnv();
  const auth = await loginAs(env);
  assert.equal((await call(env, "/staff/api/tasks", { method: "POST", rawBody: JSON.stringify({ ...validInput, notes: "x".repeat(20000) }), ...auth })).res.status, 413);
  for (const id of ["0", "abc", "1;DROP"]) assert.equal((await call(env, `/staff/api/tasks/${id}`, auth)).res.status, 404, id);
});

await test("10. 期限の状態（期限切れ・今日まで・近日中）を文字で表し、並び順は 期限切れ→期限が近い→優先度高→期限あり→期限なし→完了済み", () => {
  const today = "2026-10-17";
  const base = { title: "", assignee: "", notes: "", completedAt: null, completedBy: null, createdAt: 0, updatedAt: 0, createdBy: "", updatedBy: "" };
  const t = (id: number, dueDate: string, priority: TaskRecord["priority"], completed = false, completedAt: number | null = null): TaskRecord => ({
    ...base, id, title: `T${id}`, dueDate, priority, progress: completed ? 100 : 0, completed, completedAt,
  });
  assert.equal(dueState(t(1, "2026-10-16", "low"), today), "overdue");
  assert.equal(dueState(t(1, "2026-10-17", "low"), today), "today");
  assert.equal(dueState(t(1, "2026-10-20", "low"), today), "soon");
  assert.equal(dueState(t(1, "2026-10-21", "low"), today), "later");
  assert.equal(dueState(t(1, "", "low"), today), "none");
  assert.deepEqual([DUE_STATE_LABELS.overdue, DUE_STATE_LABELS.today, DUE_STATE_LABELS.soon], ["期限切れ", "今日まで", "近日中"]);
  const tasks = [
    t(1, "", "low"),
    t(2, "2026-12-01", "medium"),
    t(3, "", "high"),
    t(4, "2026-10-19", "low"),
    t(5, "2026-10-10", "medium"),
    t(6, "2026-10-01", "medium", true, 200),
    t(7, "2026-10-17", "high"),
    t(8, "2026-10-12", "high"),
    t(9, "2026-11-01", "high"),
    t(10, "", "medium", true, 300),
  ];
  assert.deepEqual(
    sortTasks(tasks, today).map((x) => x.id),
    [5, 8, 7, 4, 9, 3, 2, 1, 10, 6],
    "期限切れ(古い順) → 期限が近い → 優先度高（期限順・期限なしは後）→ 期限あり → 期限なし → 完了済み（新しい順）",
  );
});

await test("11. タスクは公開ページ・公開用のデータ・ビルド済みファイルに出ない", async () => {
  const env = makeEnv();
  const auth = await loginAs(env);
  await createTask(env, auth, { title: "内部タスクＸＹＺ" });
  assert.ok(!JSON.stringify(await listPublicEvents(env.STAFF_DB)).includes("内部タスク"));
  assert.ok(!JSON.stringify(await listPublicNews(env.STAFF_DB, "2099-01-01")).includes("内部タスク"));
  // 公開ページ用のFunctions（/・/news/・/events/・/dialogue/）は tasks を読み込まない
  for (const file of ["functions/index.ts", "functions/news/index.ts", "functions/events/index.ts", "functions/dialogue/index.ts", "server/publicRewrite.ts", "server/newsPublic.ts", "server/eventsPublic.ts"]) {
    assert.ok(!readFileSync(new URL(`../../${file}`, import.meta.url), "utf8").includes("tasks"), file);
  }
  // ビルド済みの公開ページ（dist、/staff/ 以外）にタスクのAPIや列名が含まれない
  const dist = new URL("../../dist/", import.meta.url);
  const walk = (dir: string): string[] =>
    readdirSync(dir).flatMap((name) => {
      const full = path.join(dir, name);
      return statSync(full).isDirectory() ? walk(full) : [full];
    });
  const distDir = decodeURIComponent(dist.pathname).replace(/^\/([A-Za-z]:)/, "$1");
  const publicFiles = walk(distDir).filter((f) => f.endsWith(".html") && !f.includes(`${path.sep}staff${path.sep}`));
  assert.ok(publicFiles.length > 10, "ビルド済みの公開ページがある（npm run build の後に実行）");
  for (const file of publicFiles) {
    const html = readFileSync(file, "utf8");
    assert.ok(!html.includes("/staff/api/tasks") && !html.includes("progress_before_completion"), file);
  }
});

await test("migration：ファイルの定義が実行時の定義と一致し、何度実行しても既存テーブル・データを壊さない", async () => {
  const text = readFileSync(new URL("../../migrations/0005_tasks.sql", import.meta.url), "utf8");
  const statements = text
    .split("\n")
    .filter((line) => !line.startsWith("--"))
    .join("\n")
    .split(/;\n/)
    .map((s) => s.trim().replace(/;$/, ""))
    .filter(Boolean);
  assert.deepEqual(statements, TASKS_SCHEMA_SQL.map((s) => s.trim()));
  for (const s of statements) assert.match(s, /^CREATE (TABLE|INDEX) IF NOT EXISTS /);
  const env = makeEnv();
  const auth = await loginAs(env);
  await createTask(env, auth);
  for (let i = 0; i < 2; i++) fakeDb(env).sqlite.exec(text);
  assert.equal(((await call(env, "/staff/api/tasks", auth)).json as { tasks: unknown[] }).tasks.length, 1);
  assert.equal((await fakeDb(env).prepare("SELECT COUNT(*) AS n FROM staff_sessions").first<{ n: number }>())!.n, 1);
});

Date.now = realNow;
console.log = realLog;
console.log(`\n${passed}件のテストに合格しました。`);
