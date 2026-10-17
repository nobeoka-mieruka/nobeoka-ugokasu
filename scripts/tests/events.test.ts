// イベント管理（/staff/events/・/staff/api/events）と、公開ページ（/events/・トップページ）・お知らせ連携のテストです。
// D1はNode標準のSQLite（node:sqlite）で再現します。実際のGoogle・Cloudflareへは一切アクセスしません。
//
// 実行: npm run test:events

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { FakeD1 } from "./helpers/fakeD1";
import type { StaffAuthEnv } from "../../server/env";
import { createSession, resetSchemaCache } from "../../server/staffAuth";
import { EVENTS_SCHEMA_SQL, listPublicEvents, resetEventsSchemaCache, validateEventInput } from "../../server/events";
import { listPublicNews, resetNewsSchemaCache } from "../../server/newsItems";
import { createDialogueEvent, listPublicDialogueEvents, resetDialogueSchemaCache } from "../../server/dialogueEvents";
import { onRequest as staffMiddleware } from "../../functions/staff/_middleware";
import * as listApi from "../../functions/staff/api/events/index";
import * as itemApi from "../../functions/staff/api/events/[id]";
import { onRequestGet as editPage } from "../../functions/staff/events/[id]/edit";
import type { EventRecord } from "../../src/types/events";
import { renderEventSchemaScripts, renderEventsPage, renderHomeEvents } from "../../src/utils/eventCards";

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
const PAGE_HTML = "<html><body><h1>イベントの管理</h1></body></html>";

function route(method: string, path: string): { handler: Handler | null; params: Record<string, string> } {
  if (path === "/staff/api/events") {
    return { handler: (method === "GET" ? listApi.onRequestGet : method === "POST" ? listApi.onRequestPost : null) as Handler | null, params: {} };
  }
  const item = /^\/staff\/api\/events\/([^/]+)$/.exec(path);
  if (item) {
    const handlers: Record<string, unknown> = { GET: itemApi.onRequestGet, PUT: itemApi.onRequestPut, PATCH: itemApi.onRequestPatch, DELETE: itemApi.onRequestDelete };
    return { handler: (handlers[method] ?? null) as Handler | null, params: { id: item[1] } };
  }
  const edit = /^\/staff\/events\/([^/]+)\/edit\/?$/.exec(path);
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

async function call(env: Env, path: string, options: CallOptions = {}) {
  const method = options.method ?? "GET";
  const headers = new Headers({ "CF-Connecting-IP": "203.0.113.10" });
  if (options.cookie) headers.set("Cookie", options.cookie);
  if (options.csrf) headers.set("X-CSRF-Token", options.csrf);
  if (method !== "GET") {
    if (options.origin !== null) headers.set("Origin", options.origin ?? ORIGIN);
    headers.set("Content-Type", "application/json");
  }
  const body = options.rawBody ?? (options.body === undefined ? undefined : JSON.stringify(options.body));
  const request = new Request(`${ORIGIN}${path}`, { method, headers, body });
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

/** 内部管理用の値（公開されてはいけない）。テストで公開HTML等に含まれないことを確認する */
const SECRET_PERSON = "担当者ヤマダ内部";
const SECRET_ITEMS = "必要物品テント内部";
const SECRET_NOTES = "内部メモ非公開の連絡事項";

const validInput = {
  title: "延岡駅前クリーン活動",
  eventDate: "2099-11-08",
  startTime: "09:00",
  endTime: "11:00",
  venue: "延岡駅前",
  address: "宮崎県延岡市幸町",
  description: "地域の皆さまと一緒に駅前を清掃します。",
  category: "volunteer",
  status: "open",
  visibility: "public",
  capacity: "30",
  volunteerTarget: "10",
  volunteerCount: "3",
  personInCharge: SECRET_PERSON,
  requiredItems: SECRET_ITEMS,
  internalNotes: SECRET_NOTES,
  displayOrder: "0",
  postToNews: false,
};

async function createEvent(env: Env, auth: Auth, overrides: Record<string, unknown> = {}) {
  const r = await call(env, "/staff/api/events", { method: "POST", body: { ...validInput, ...overrides }, ...auth });
  assert.equal(r.res.status, 201, r.text);
  return r.json as { event: EventRecord; news: string };
}

async function listEvents(env: Env, auth: Auth) {
  const r = await call(env, "/staff/api/events", auth);
  assert.equal(r.res.status, 200);
  return (r.json as { events: EventRecord[] }).events;
}

const auditActions = async (env: Env) =>
  (await fakeDb(env).prepare("SELECT action FROM staff_audit_log WHERE target_type = 'event' ORDER BY id").all<{ action: string }>()).results.map((r) => r.action);

let passed = 0;
async function test(name: string, fn: () => Promise<void> | void) {
  timeOffsetMs = 0;
  assetsRequested = [];
  resetSchemaCache();
  resetDialogueSchemaCache();
  resetNewsSchemaCache();
  resetEventsSchemaCache();
  try {
    await fn();
    passed++;
    realLog(`✓ ${name}`);
  } catch (err) {
    console.error(`✗ ${name}`);
    throw err;
  }
}

// ======================= 管理機能 =======================
await test("1. 未ログインでは /staff/events/ に入れず、APIも内容を返さない", async () => {
  const env = makeEnv();
  for (const path of ["/staff/events/", "/staff/events/new/", "/staff/events/1/edit/"]) {
    const r = await call(env, path);
    assert.equal(r.res.status, 302, path);
    assert.equal(r.res.headers.get("Location"), "/staff/login/", path);
    assert.equal(r.reachedHandler, false, path);
  }
  for (const [method, path] of [["GET", "/staff/api/events"], ["POST", "/staff/api/events"], ["DELETE", "/staff/api/events/1"]]) {
    const r = await call(env, path, { method, body: method === "GET" ? undefined : validInput });
    assert.equal(r.res.status, 401, `${method} ${path}`);
    assert.ok(!r.text.includes(SECRET_NOTES));
  }
});

await test("2. 新規登録でき、作成者・操作ログが記録される（公開範囲の初期値は執行部のみ・ログに内部情報を出さない）", async () => {
  const env = makeEnv();
  const auth = await loginAs(env);
  logLines.length = 0;
  const { event } = await createEvent(env, auth);
  assert.equal(event.title, "延岡駅前クリーン活動");
  assert.equal(event.capacity, 30);
  assert.equal(event.volunteerTarget, 10);
  assert.equal(event.personInCharge, SECRET_PERSON);
  assert.equal(event.createdBy, STAFF);
  assert.deepEqual(await auditActions(env), ["event.create"]);
  const logs = logLines.join("\n");
  for (const secret of [SECRET_PERSON, SECRET_ITEMS, SECRET_NOTES, "example.com"]) assert.ok(!logs.includes(secret), secret);
  const audit = await fakeDb(env).prepare("SELECT detail FROM staff_audit_log").all<{ detail: string }>();
  assert.ok(!JSON.stringify(audit.results).includes(SECRET_NOTES), "操作ログにも内部メモの内容は残さない");
  // 公開範囲を省略した場合は登録できない（必ず選ばせる）。画面の初期値は「執行部のみ」
  const { visibility: _v, ...withoutVisibility } = validInput;
  assert.equal((await call(env, "/staff/api/events", { method: "POST", body: withoutVisibility, ...auth })).res.status, 422);
  assert.ok(readFileSync(new URL("../../src/components/staff/EventForm.astro", import.meta.url), "utf8").includes('value="internal" checked'));
  const page = await call(env, "/staff/events/", auth);
  assert.equal(page.res.status, 200);
  assert.equal(page.res.headers.get("X-Robots-Tag"), "noindex, nofollow");
});

await test("3. 編集でき、updated_at・updated_by と変更項目、ステータス・公開範囲の変更が記録される", async () => {
  const env = makeEnv();
  const auth = await loginAs(env);
  const { event } = await createEvent(env, auth, { visibility: "internal" });
  timeOffsetMs = 60_000;
  const r = await call(env, `/staff/api/events/${event.id}`, {
    method: "PUT",
    body: { ...validInput, title: "延岡駅前クリーン活動（第2回）", status: "scheduled", visibility: "public", internalNotes: "メモ更新" },
    ...auth,
  });
  assert.equal(r.res.status, 200, r.text);
  const updated = (r.json as { event: EventRecord }).event;
  assert.equal(updated.title, "延岡駅前クリーン活動（第2回）");
  assert.equal(updated.status, "scheduled");
  assert.equal(updated.visibility, "public");
  assert.ok(updated.updatedAt >= event.updatedAt + 60);
  assert.equal(updated.updatedBy, STAFF);
  assert.deepEqual(await auditActions(env), ["event.create", "event.update", "event.status", "event.visibility"]);
  const detail = await fakeDb(env).prepare("SELECT detail FROM staff_audit_log WHERE action = 'event.update'").first<{ detail: string }>();
  assert.deepEqual(JSON.parse(detail!.detail).changed, ["title", "status", "visibility", "internalNotes"]);
  assert.ok(!detail!.detail.includes("メモ更新"), "内部メモは項目名だけを記録する");
  const edit = await call(env, `/staff/events/${event.id}/edit/`, auth);
  assert.equal(edit.res.status, 200);
  assert.deepEqual(assetsRequested, ["/staff/events/edit/"]);
  assert.equal((await call(env, "/staff/events/abc/edit/", auth)).res.status, 404);
  assert.equal((await call(env, "/staff/api/events/999", { method: "PUT", body: validInput, ...auth })).res.status, 404);
});

await test("4. 削除（論理削除）すると一覧・公開から消え、行は残る", async () => {
  const env = makeEnv();
  const auth = await loginAs(env);
  const { event } = await createEvent(env, auth);
  assert.equal((await call(env, `/staff/api/events/${event.id}`, { method: "DELETE", ...auth })).res.status, 200);
  assert.deepEqual(await listEvents(env, auth), []);
  assert.deepEqual(await listPublicEvents(env.STAFF_DB), []);
  const row = await fakeDb(env).prepare("SELECT deleted_at, deleted_by FROM events WHERE id = ?1").bind(event.id).first<{ deleted_at: number; deleted_by: string }>();
  assert.ok(row!.deleted_at > 0);
  assert.equal(row!.deleted_by, STAFF);
  assert.equal((await call(env, `/staff/api/events/${event.id}`, { method: "DELETE", ...auth })).res.status, 404);
  assert.deepEqual((await auditActions(env)).at(-1), "event.delete");
});

await test("5. ステータスを変更できる（PATCH）・不正なステータスは拒否", async () => {
  const env = makeEnv();
  const auth = await loginAs(env);
  const { event } = await createEvent(env, auth);
  for (const status of ["planning", "preparing", "open", "scheduled", "completed", "cancelled"]) {
    const r = await call(env, `/staff/api/events/${event.id}`, { method: "PATCH", body: { status }, ...auth });
    assert.equal(r.res.status, 200, status);
    assert.equal((r.json as { event: EventRecord }).event.status, status);
  }
  for (const status of ["done", "終了", "", null, "OPEN"]) {
    assert.equal((await call(env, `/staff/api/events/${event.id}`, { method: "PATCH", body: { status }, ...auth })).res.status, 422, String(status));
    assert.equal((await call(env, "/staff/api/events", { method: "POST", body: { ...validInput, status }, ...auth })).res.status, 422, String(status));
  }
});

await test("6. CSRFトークン無し・不一致・別サイトからの更新要求は403", async () => {
  const env = makeEnv();
  const auth = await loginAs(env);
  const { event } = await createEvent(env, auth);
  const attempts: [string, CallOptions][] = [
    ["/staff/api/events", { method: "POST", body: validInput, cookie: auth.cookie }],
    ["/staff/api/events", { method: "POST", body: validInput, cookie: auth.cookie, csrf: "wrong" }],
    ["/staff/api/events", { method: "POST", body: validInput, ...auth, origin: "https://evil.example.com" }],
    [`/staff/api/events/${event.id}`, { method: "PUT", body: validInput, ...auth, origin: null }],
    [`/staff/api/events/${event.id}`, { method: "PATCH", body: { status: "cancelled" }, cookie: auth.cookie }],
    [`/staff/api/events/${event.id}`, { method: "DELETE", cookie: auth.cookie, csrf: "wrong" }],
  ];
  for (const [path, options] of attempts) {
    const r = await call(env, path, options);
    assert.equal(r.res.status, 403, `${options.method} ${path}`);
    assert.equal(r.reachedHandler, false);
  }
  const events = await listEvents(env, auth);
  assert.equal(events.length, 1);
  assert.equal(events[0].status, "open", "拒否された要求では何も変わらない");
});

await test("7. 不正な category・status・visibility を拒否する", () => {
  for (const [field, values] of [
    ["category", ["dialogue", "意見交換", "", null, "SUPPORTERS"]],
    ["status", ["done", "", null]],
    ["visibility", ["private", "PUBLIC", "", null, true]],
  ] as const) {
    for (const value of values) {
      const r = validateEventInput({ ...validInput, [field]: value });
      assert.equal(r.ok, false, `${field}=${String(value)}`);
      if (!r.ok) assert.ok(r.errors[field], `${field}=${String(value)}`);
    }
  }
  for (const category of ["supporters", "community", "exchange", "volunteer", "street", "meeting", "other"]) {
    assert.ok(validateEventInput({ ...validInput, category }).ok, category);
  }
});

await test("8. 入力値検証（文字数・日時・定員とボランティア人数は0以上の整数・内部メモ上限・過大な本文）", async () => {
  const cases: [Record<string, unknown>, string][] = [
    [{ title: "" }, "title"],
    [{ title: "あ".repeat(101) }, "title"],
    [{ venue: "" }, "venue"],
    [{ description: "x".repeat(2001) }, "description"],
    [{ internalNotes: "x".repeat(2001) }, "internalNotes"],
    [{ requiredItems: "x".repeat(1001) }, "requiredItems"],
    [{ personInCharge: "x".repeat(101) }, "personInCharge"],
    [{ eventDate: "2026-13-01" }, "eventDate"],
    [{ startTime: "25:00" }, "startTime"],
    [{ endTime: "08:00" }, "endTime"],
    [{ capacity: "-1" }, "capacity"],
    [{ capacity: "1.5" }, "capacity"],
    [{ capacity: "abc" }, "capacity"],
    [{ volunteerTarget: "-3" }, "volunteerTarget"],
    [{ volunteerCount: "2.5" }, "volunteerCount"],
    [{ volunteerCount: "99999" }, "volunteerCount"],
    [{ title: "イベント\u202Eです" }, "title"],
    [{ postToNews: "yes" }, "postToNews"],
    [{ postToNews: true, visibility: "internal" }, "postToNews"],
  ];
  for (const [override, field] of cases) {
    const r = validateEventInput({ ...validInput, ...override });
    assert.equal(r.ok, false, JSON.stringify(override));
    if (!r.ok) assert.ok(r.errors[field as keyof typeof r.errors], `${JSON.stringify(override)} → ${field}`);
  }
  const zero = validateEventInput({ ...validInput, capacity: "0", volunteerTarget: "0", volunteerCount: "" });
  assert.ok(zero.ok, "0 は許可");
  if (zero.ok) assert.deepEqual([zero.value.capacity, zero.value.volunteerTarget, zero.value.volunteerCount], [0, 0, 0]);
  const env = makeEnv();
  const auth = await loginAs(env);
  const big = await call(env, "/staff/api/events", { method: "POST", rawBody: JSON.stringify({ ...validInput, internalNotes: "x".repeat(20000) }), ...auth });
  assert.equal(big.res.status, 413);
  for (const id of ["0", "abc", "1;DROP"]) assert.equal((await call(env, `/staff/api/events/${id}`, auth)).res.status, 404, id);
});

await test("migration：ファイルの定義が実行時の定義と一致し、何度実行しても既存テーブル・データを壊さない", async () => {
  const text = readFileSync(new URL("../../migrations/0004_events.sql", import.meta.url), "utf8");
  const statements = text
    .split("\n")
    .filter((line) => !line.startsWith("--"))
    .join("\n")
    .split(/;\n/)
    .map((s) => s.trim().replace(/;$/, ""))
    .filter(Boolean);
  assert.deepEqual(statements, EVENTS_SCHEMA_SQL.map((s) => s.trim()));
  for (const s of statements) assert.match(s, /^CREATE (TABLE|INDEX) IF NOT EXISTS /);

  const env = makeEnv();
  const auth = await loginAs(env);
  const dialogue = await createDialogueEvent(env.STAFF_DB, {
    title: "意見交換会", eventDate: "2099-11-08", startTime: "10:00", endTime: "", venue: "公民館", address: "", description: "",
    capacity: null, status: "open", applicationOpen: true, isPublished: true, displayOrder: 0,
  }, STAFF);
  await createEvent(env, auth);
  const db = fakeDb(env);
  for (let i = 0; i < 2; i++) db.sqlite.exec(text);
  assert.equal((await listEvents(env, auth)).length, 1);
  assert.equal((await db.prepare("SELECT COUNT(*) AS n FROM staff_sessions").first<{ n: number }>())!.n, 1);
  assert.deepEqual((await listPublicDialogueEvents(env.STAFF_DB)).map((e) => e.id), [dialogue.id], "意見交換会は別テーブルのまま");
  assert.equal((await listPublicNews(env.STAFF_DB, "2026-10-17")).items.length, 6, "お知らせ（移行データ）も残る");
});

// ======================= 公開ページ =======================
const TODAY = "2026-10-17";
const titlesIn = (html: string) => [...html.matchAll(/<h3[^>]*>([^<]*)<\/h3>/g)].map((m) => m[1]);

await test("9. 一般公開のイベントだけを公開し、執行部のみ・内部管理用の項目は公開HTML・構造化データ・公開用データに出さない", async () => {
  const env = makeEnv();
  const auth = await loginAs(env);
  await createEvent(env, auth, { title: "公開イベント" });
  await createEvent(env, auth, { title: "執行部会議（内部）", visibility: "internal", category: "meeting" });
  const events = await listPublicEvents(env.STAFF_DB);
  assert.deepEqual(events.map((e) => e.title), ["公開イベント"]);
  assert.deepEqual(Object.keys(events[0]).sort(), ["address", "category", "description", "displayOrder", "endTime", "eventDate", "id", "startTime", "status", "title", "venue"]);
  const page = renderEventsPage(events, TODAY);
  const home = renderHomeEvents(events, TODAY);
  const schema = renderEventSchemaScripts(events, TODAY);
  for (const html of [page, home, schema, JSON.stringify(events)]) {
    for (const secret of [SECRET_PERSON, SECRET_ITEMS, SECRET_NOTES, "執行部会議", STAFF]) assert.ok(!html.includes(secret), secret);
  }
  // 公開用のSQLは内部管理用の列をそもそも読み出さない
  const source = readFileSync(new URL("../../server/events.ts", import.meta.url), "utf8");
  const publicColumns = /const PUBLIC_COLUMNS = "([^"]+)"/.exec(source)![1];
  for (const column of ["person_in_charge", "required_items", "internal_notes", "volunteer", "capacity", "created_by", "visibility"]) {
    assert.ok(!publicColumns.includes(column), column);
  }
  assert.ok(page.includes("公開イベント") && page.includes("ボランティア") && page.includes("受付中"), "カテゴリー・ステータスは日本語表示");
  assert.ok(page.includes('id="event-'), "お知らせからのリンク先（#event-<id>）");
});

await test("10. /events/：今後のイベントを上に、終了・開催日を過ぎたものは「これまでのイベント」に。中止は今後側に「中止」と表示", async () => {
  const env = makeEnv();
  const auth = await loginAs(env);
  await createEvent(env, auth, { title: "12月の催し", eventDate: "2099-12-01" });
  await createEvent(env, auth, { title: "11月の催し", eventDate: "2099-11-01" });
  await createEvent(env, auth, { title: "中止の催し", eventDate: "2099-11-15", status: "cancelled" });
  await createEvent(env, auth, { title: "終了した催し", eventDate: "2026-09-01", status: "completed" });
  await createEvent(env, auth, { title: "日付が過ぎた催し", eventDate: "2026-10-16", status: "scheduled" });
  const page = renderEventsPage(await listPublicEvents(env.STAFF_DB), TODAY);
  const [upcoming, past] = page.split("これまでのイベント");
  assert.deepEqual(titlesIn(upcoming), ["11月の催し", "中止の催し", "12月の催し"], "開催日の近い順");
  assert.ok(upcoming.includes(">中止</span>"));
  assert.ok(past.includes("日付が過ぎた催し") && past.includes("終了した催し"));
  assert.ok(past.indexOf("日付が過ぎた催し") < past.indexOf("終了した催し"), "これまでの分は新しい順");
  assert.ok(renderEventsPage([], TODAY).includes("現在お知らせできるイベントはありません"));
  const schemas = renderEventSchemaScripts(await listPublicEvents(env.STAFF_DB), TODAY);
  assert.ok(schemas.includes("EventCancelled") && schemas.includes("EventScheduled"));
});

await test("11. トップページ「今後のイベント」は直近3件まで・中止は出さない・予定が無ければセクションごと出さない", async () => {
  const env = makeEnv();
  const auth = await loginAs(env);
  assert.equal(renderHomeEvents(await listPublicEvents(env.STAFF_DB), TODAY), "", "予定が無ければ空");
  for (const [title, eventDate, status] of [
    ["A", "2099-11-01", "open"],
    ["B", "2099-11-02", "cancelled"],
    ["C", "2099-11-03", "scheduled"],
    ["D", "2099-11-04", "planning"],
    ["E", "2099-11-05", "open"],
  ]) {
    await createEvent(env, auth, { title, eventDate, status });
  }
  await createEvent(env, auth, { title: "内部", eventDate: "2099-10-20", visibility: "internal" });
  const home = renderHomeEvents(await listPublicEvents(env.STAFF_DB), TODAY);
  assert.deepEqual(titlesIn(home), ["A", "C", "D"]);
  assert.ok(home.includes("今後のイベント") && home.includes('<a href="/events/" class="btn-secondary">イベント一覧を見る</a>'));
});

await test("12. XSS対策：イベントの内容はエスケープし、構造化データからも抜け出せない", async () => {
  const env = makeEnv();
  const auth = await loginAs(env);
  await createEvent(env, auth, { title: "<script>alert(1)</script>", venue: '"><img src=x onerror=alert(1)>', description: "</script><script>alert(2)</script>" });
  const events = await listPublicEvents(env.STAFF_DB);
  for (const html of [renderEventsPage(events, TODAY), renderHomeEvents(events, TODAY)]) {
    assert.ok(!html.includes("<script>") && !html.includes("<img"));
    assert.ok(html.includes("&lt;script&gt;alert(1)&lt;/script&gt;"));
  }
  const schema = renderEventSchemaScripts(events, TODAY);
  assert.equal(schema.match(/<\/script>/g)?.length, 1);
  assert.ok(!schema.includes("<img"));
});

// ======================= お知らせ連携 =======================
const newsRows = async (env: Env) =>
  (await fakeDb(env).prepare("SELECT id, source_key, category, title, summary, link_url, is_published, deleted_at, published_on FROM news_items WHERE source_key LIKE 'event:%'").all<{
    id: number; source_key: string; category: string; title: string; summary: string; link_url: string; is_published: number; deleted_at: number | null; published_on: string;
  }>()).results;

await test("13. 「最新のお知らせにも掲載する」がオンの一般公開イベントだけ、カテゴリー「イベント」で1件掲載する（内部情報は含めない）", async () => {
  const env = makeEnv();
  const auth = await loginAs(env);
  const off = await createEvent(env, auth, { title: "掲載しない" });
  assert.equal(off.news, "none");
  const on = await createEvent(env, auth, { title: "掲載する", postToNews: true });
  assert.equal(on.news, "created");
  assert.equal(on.event.postedToNews, true);
  const internal = await call(env, "/staff/api/events", { method: "POST", body: { ...validInput, visibility: "internal", postToNews: true }, ...auth });
  assert.equal(internal.res.status, 422, "執行部のみのイベントはお知らせに掲載できない");
  const rows = await newsRows(env);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].source_key, `event:${on.event.id}`);
  assert.equal(rows[0].category, "event");
  assert.equal(rows[0].title, "掲載する");
  assert.equal(rows[0].link_url, `/events/#event-${on.event.id}`);
  assert.ok(rows[0].summary.includes("2099年11月8日") && rows[0].summary.includes("会場：延岡駅前"));
  for (const secret of [SECRET_PERSON, SECRET_ITEMS, SECRET_NOTES]) assert.ok(!JSON.stringify(rows).includes(secret), secret);
  const publicNews = await listPublicNews(env.STAFF_DB, "2099-01-01");
  assert.ok(publicNews.items.some((item) => item.title === "掲載する" && item.category === "イベント"));
});

await test("14. 重複防止：同じイベントを何度保存してもお知らせは1件のまま。編集すると内容が更新され、掲載日は変わらない", async () => {
  const env = makeEnv();
  const auth = await loginAs(env);
  const { event } = await createEvent(env, auth, { postToNews: true });
  const firstDate = (await newsRows(env))[0].published_on;
  timeOffsetMs = 3 * 24 * 60 * 60 * 1000;
  await fakeDb(env).prepare("DELETE FROM staff_sessions").run();
  const later = await loginAs(env); // 3日後に改めてログインして編集する
  for (let i = 0; i < 3; i++) {
    const r = await call(env, `/staff/api/events/${event.id}`, { method: "PUT", body: { ...validInput, title: `改名${i}`, postToNews: true }, ...later });
    assert.equal(r.res.status, 200);
    assert.equal((r.json as { news: string }).news, "updated");
  }
  const rows = await newsRows(env);
  assert.equal(rows.length, 1, "重複して作られない");
  assert.equal(rows[0].title, "改名2", "イベントの編集に合わせて更新");
  assert.equal(rows[0].published_on, firstDate, "掲載日は最初の日のまま");
  // 直接 createNewsItem で同じキーを作ろうとしても作られない（source_key は一意）
  const { createNewsItem } = await import("../../server/newsItems");
  assert.equal(await createNewsItem(env.STAFF_DB, { publishedOn: "2099-01-01", category: "event", title: "x", summary: "y", linkUrl: "", isPublished: true, displayOrder: 0 }, STAFF, `event:${event.id}`), null);
  assert.equal((await newsRows(env)).length, 1);
});

await test("15. 掲載をやめる・執行部のみにする・削除すると、お知らせは非公開になる（削除はしない）。再度オンにすると元に戻る", async () => {
  const env = makeEnv();
  const auth = await loginAs(env);
  const { event } = await createEvent(env, auth, { postToNews: true });
  const put = (body: Record<string, unknown>) => call(env, `/staff/api/events/${event.id}`, { method: "PUT", body: { ...validInput, ...body }, ...auth });

  let r = await put({ postToNews: false });
  assert.equal((r.json as { news: string }).news, "unpublished");
  assert.equal((await newsRows(env))[0].is_published, 0);
  assert.equal((r.json as { event: EventRecord }).event.postedToNews, false);

  r = await put({ postToNews: true });
  assert.equal((r.json as { news: string }).news, "updated");
  assert.equal((await newsRows(env))[0].is_published, 1);

  r = await put({ visibility: "internal", postToNews: false });
  assert.equal((r.json as { news: string }).news, "unpublished", "執行部のみにしたら非公開");
  const linkedKey = `d1:${(await newsRows(env))[0].id}`;
  assert.ok(!(await listPublicNews(env.STAFF_DB, "2099-01-01")).items.some((i) => i.key === linkedKey));

  await put({ visibility: "public", postToNews: true });
  const del = await call(env, `/staff/api/events/${event.id}`, { method: "DELETE", ...auth });
  assert.equal((del.json as { news: string }).news, "unpublished", "イベント削除でお知らせは非公開");
  const rows = await newsRows(env);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].is_published, 0);
  assert.equal(rows[0].deleted_at, null, "お知らせの行は消さない（お知らせ管理から確認できる）");
  const audit = await fakeDb(env).prepare("SELECT COUNT(*) AS n FROM staff_audit_log WHERE action = 'news.sync'").first<{ n: number }>();
  assert.ok(audit!.n >= 4, "お知らせの連携も操作ログに残る");
});

await test("16. お知らせ管理側で削除したお知らせは、イベント側で再度オンにすると元に戻る（新しく重複作成しない）", async () => {
  const env = makeEnv();
  const auth = await loginAs(env);
  const { event } = await createEvent(env, auth, { postToNews: true });
  const newsId = (await newsRows(env))[0].id;
  const { deleteNewsItem } = await import("../../server/newsItems");
  await deleteNewsItem(env.STAFF_DB, newsId, STAFF);
  const r = await call(env, `/staff/api/events/${event.id}`, { method: "PUT", body: { ...validInput, postToNews: true }, ...auth });
  assert.equal((r.json as { news: string }).news, "updated");
  const rows = await newsRows(env);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].id, newsId);
  assert.equal(rows[0].deleted_at, null);
});

Date.now = realNow;
console.log = realLog;
console.log(`\n${passed}件のテストに合格しました。`);
