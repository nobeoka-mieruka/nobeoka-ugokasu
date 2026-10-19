// 意見交換会管理（/staff/dialogue/・/staff/api/dialogue-events）と公開ページ /dialogue/ の表示のテストです。
// D1はNode標準のSQLite（node:sqlite）で再現します。実際のGoogle・Cloudflareへは一切アクセスしません。
//
// 実行: npm run test:dialogue

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { FakeD1 } from "./helpers/fakeD1";
import type { StaffAuthEnv } from "../../server/env";
import { createSession, resetSchemaCache } from "../../server/staffAuth";
import {
  DIALOGUE_SCHEMA_SQL,
  listPublicDialogueEvents,
  resetDialogueSchemaCache,
  validateDialogueInput,
} from "../../server/dialogueEvents";
import { onRequest as staffMiddleware } from "../../functions/staff/_middleware";
import * as listApi from "../../functions/staff/api/dialogue-events/index";
import * as itemApi from "../../functions/staff/api/dialogue-events/[id]";
import { onRequestGet as editPage } from "../../functions/staff/dialogue/[id]/edit";
import { renderDialogueSchedule, renderDialogueSchemaScripts } from "../../src/utils/dialogueSchedule";
import type { DialogueEvent, DialogueEventRecord } from "../../src/types/dialogue";

(globalThis as Record<string, unknown>).HTMLRewriter = class {
  on() {
    return this;
  }
  transform(res: Response) {
    return res;
  }
};

// サーバーログを記録する（メールアドレスや内容が出ていないことを確認する）
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

const realNow = Date.now;
let timeOffsetMs = 0;
Date.now = () => realNow() + timeOffsetMs;

/** ログインしてセッションCookieとCSRFトークンを得る */
async function loginAs(env: Env) {
  const sessionId = await createSession(env.STAFF_DB, STAFF);
  const csrf = (await (env.STAFF_DB as unknown as FakeD1).prepare("SELECT csrf_token FROM staff_sessions").first<{ csrf_token: string }>())!.csrf_token;
  return { cookie: `staff_session=${sessionId}`, csrf };
}

type Handler = (ctx: never) => Response | Promise<Response>;
const PORTAL_HTML = '<html><body><h1>意見交換会の管理</h1></body></html>';

/** パスに応じてミドルウェアの先の処理（API・静的ページ）を選ぶ（Cloudflare Pagesのルーティングの代わり） */
function route(method: string, path: string): { handler: Handler | null; params: Record<string, string> } {
  const item = /^\/staff\/api\/dialogue-events\/([^/]+)$/.exec(path);
  if (path === "/staff/api/dialogue-events") {
    return { handler: (method === "GET" ? listApi.onRequestGet : method === "POST" ? listApi.onRequestPost : null) as Handler | null, params: {} };
  }
  if (item) {
    const handlers: Record<string, unknown> = {
      GET: itemApi.onRequestGet,
      PUT: itemApi.onRequestPut,
      PATCH: itemApi.onRequestPatch,
      DELETE: itemApi.onRequestDelete,
    };
    return { handler: (handlers[method] ?? null) as Handler | null, params: { id: item[1] } };
  }
  const edit = /^\/staff\/dialogue\/([^/]+)\/edit\/?$/.exec(path);
  if (edit) return { handler: editPage as Handler, params: { id: edit[1] } };
  return { handler: null, params: {} };
}

interface CallOptions {
  method?: string;
  body?: unknown;
  rawBody?: string;
  contentType?: string;
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
    headers.set("Content-Type", options.contentType ?? "application/json");
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
        return new Response(PORTAL_HTML, { headers: { "Content-Type": "text/html; charset=utf-8" } });
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
      if (!handler) return new Response(PORTAL_HTML, { headers: { "Content-Type": "text/html; charset=utf-8" } });
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

const validInput = {
  title: "意見交換会",
  eventDate: "2099-11-08",
  startTime: "10:00",
  endTime: "11:30",
  venue: "南方地区公民館",
  address: "宮崎県延岡市○○町1-2-3",
  description: "延岡のこれからについてお話ししませんか？",
  capacity: "20",
  status: "open",
  applicationOpen: true,
  isPublished: true,
  displayOrder: "0",
};

async function createEvent(env: Env, auth: { cookie: string; csrf: string }, overrides: Record<string, unknown> = {}) {
  const r = await call(env, "/staff/api/dialogue-events", { method: "POST", body: { ...validInput, ...overrides }, ...auth });
  assert.equal(r.res.status, 201, r.text);
  return (r.json as { event: DialogueEventRecord }).event;
}

const publicEvent = (overrides: Partial<DialogueEvent> = {}): DialogueEvent => ({
  id: 1,
  title: "意見交換会",
  eventDate: "2099-11-08",
  startTime: "10:00",
  endTime: "11:30",
  venue: "南方地区公民館",
  address: "",
  description: "",
  capacity: null,
  status: "open",
  applicationOpen: true,
  displayOrder: 0,
  ...overrides,
});

let passed = 0;
async function test(name: string, fn: () => Promise<void> | void) {
  timeOffsetMs = 0;
  assetsRequested = [];
  resetSchemaCache();
  resetDialogueSchemaCache();
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
await test("1. 未ログインでは /staff/dialogue/ に入れず、APIも内容を返さない", async () => {
  const env = makeEnv();
  for (const path of ["/staff/dialogue/", "/staff/dialogue/new/", "/staff/dialogue/1/edit/"]) {
    const r = await call(env, path);
    assert.equal(r.res.status, 302, path);
    assert.equal(r.res.headers.get("Location"), "/staff/login/", path);
    assert.equal(r.reachedHandler, false, path);
    assert.ok(!r.text.includes("意見交換会の管理"), path);
  }
  const api = await call(env, "/staff/api/dialogue-events");
  assert.equal(api.res.status, 401);
  assert.equal(api.reachedHandler, false);
  const post = await call(env, "/staff/api/dialogue-events", { method: "POST", body: validInput });
  assert.equal(post.res.status, 401);
  const count = await (env.STAFF_DB as unknown as FakeD1).prepare("SELECT name FROM sqlite_master WHERE name = 'dialogue_events'").first();
  assert.equal(count, null, "未ログインの要求ではテーブルにも触れない");
});

await test("2. ログイン済みで一覧を表示できる（noindex・キャッシュ禁止）", async () => {
  const env = makeEnv();
  const auth = await loginAs(env);
  const page = await call(env, "/staff/dialogue/", auth);
  assert.equal(page.res.status, 200);
  assert.equal(page.res.headers.get("X-Robots-Tag"), "noindex, nofollow");
  const list = await call(env, "/staff/api/dialogue-events", auth);
  assert.equal(list.res.status, 200);
  assert.deepEqual(list.json, { ok: true, events: [] });
  assert.equal(list.res.headers.get("Cache-Control"), "private, no-store, no-transform");
});

await test("3. 新規登録でき、作成者・操作ログが記録される（サーバーログにメールアドレスを出さない）", async () => {
  const env = makeEnv();
  const auth = await loginAs(env);
  logLines.length = 0;
  const event = await createEvent(env, auth);
  assert.equal(event.title, "意見交換会");
  assert.equal(event.capacity, 20);
  assert.equal(event.createdBy, STAFF);
  assert.equal(event.updatedBy, STAFF);
  const audit = await (env.STAFF_DB as unknown as FakeD1)
    .prepare("SELECT action, target_id, actor_email FROM staff_audit_log")
    .all<{ action: string; target_id: string; actor_email: string }>();
  assert.deepEqual(audit.results, [{ action: "dialogue.create", target_id: String(event.id), actor_email: STAFF }]);
  assert.ok(logLines.some((l) => l.includes('"action":"dialogue.create"')));
  assert.ok(!logLines.join("\n").includes("example.com"), "サーバーログにメールアドレスを出さない");
  const list = await call(env, "/staff/api/dialogue-events", auth);
  assert.equal((list.json as { events: unknown[] }).events.length, 1);
});

await test("4. 編集でき、updated_at・updated_by が更新される", async () => {
  const env = makeEnv();
  const auth = await loginAs(env);
  const created = await createEvent(env, auth);
  timeOffsetMs = 60_000;
  const r = await call(env, `/staff/api/dialogue-events/${created.id}`, {
    method: "PUT",
    body: { ...validInput, title: "第2回 意見交換会", venue: "北方地区公民館" },
    ...auth,
  });
  assert.equal(r.res.status, 200, r.text);
  const updated = (r.json as { event: DialogueEventRecord }).event;
  assert.equal(updated.title, "第2回 意見交換会");
  assert.equal(updated.venue, "北方地区公民館");
  assert.ok(updated.updatedAt >= created.updatedAt + 60, "updated_at が新しくなる");
  assert.equal(updated.createdAt, created.createdAt, "created_at は変わらない");
  const audit = await (env.STAFF_DB as unknown as FakeD1)
    .prepare("SELECT detail FROM staff_audit_log WHERE action = 'dialogue.update'")
    .first<{ detail: string }>();
  assert.deepEqual(JSON.parse(audit!.detail).changed, ["title", "venue"]);
  const edit = await call(env, `/staff/dialogue/${created.id}/edit/`, auth);
  assert.equal(edit.res.status, 200);
  assert.deepEqual(assetsRequested, ["/staff/dialogue/edit/"], "編集画面は静的HTMLを返す");
  assert.equal((await call(env, "/staff/dialogue/abc/edit/", auth)).res.status, 404);
  assert.equal((await call(env, `/staff/api/dialogue-events/999`, { method: "PUT", body: validInput, ...auth })).res.status, 404);
});

await test("5. 削除（論理削除）すると一覧・公開ページから消えるが、行は残る", async () => {
  const env = makeEnv();
  const auth = await loginAs(env);
  const created = await createEvent(env, auth);
  const r = await call(env, `/staff/api/dialogue-events/${created.id}`, { method: "DELETE", ...auth });
  assert.equal(r.res.status, 200);
  assert.deepEqual((await call(env, "/staff/api/dialogue-events", auth)).json, { ok: true, events: [] });
  assert.deepEqual(await listPublicDialogueEvents(env.STAFF_DB), []);
  const row = await (env.STAFF_DB as unknown as FakeD1)
    .prepare("SELECT deleted_at, deleted_by FROM dialogue_events WHERE id = ?1")
    .bind(created.id)
    .first<{ deleted_at: number; deleted_by: string }>();
  assert.ok(row!.deleted_at > 0);
  assert.equal(row!.deleted_by, STAFF);
  assert.equal((await call(env, `/staff/api/dialogue-events/${created.id}`, { method: "DELETE", ...auth })).res.status, 404, "二重削除は404");
  assert.equal((await call(env, `/staff/api/dialogue-events/${created.id}`, auth)).res.status, 404, "削除済みは取得できない");
});

await test("6. 受付状況を変更できる（PATCH）", async () => {
  const env = makeEnv();
  const auth = await loginAs(env);
  const created = await createEvent(env, auth);
  for (const status of ["closed", "scheduling", "completed", "open"]) {
    const r = await call(env, `/staff/api/dialogue-events/${created.id}`, { method: "PATCH", body: { status }, ...auth });
    assert.equal(r.res.status, 200, status);
    assert.equal((r.json as { event: DialogueEventRecord }).event.status, status);
  }
  const off = await call(env, `/staff/api/dialogue-events/${created.id}`, { method: "PATCH", body: { status: "open", applicationOpen: false }, ...auth });
  assert.equal((off.json as { event: DialogueEventRecord }).event.applicationOpen, false);
  const audit = await (env.STAFF_DB as unknown as FakeD1).prepare("SELECT COUNT(*) AS n FROM staff_audit_log WHERE action = 'dialogue.status'").first<{ n: number }>();
  assert.equal(audit!.n, 5);
});

await test("7. CSRFトークン無し・不一致・別サイトからの更新要求は403", async () => {
  const env = makeEnv();
  const auth = await loginAs(env);
  const created = await createEvent(env, auth);
  const attempts: [string, CallOptions][] = [
    ["POST", { method: "POST", body: validInput, cookie: auth.cookie }],
    ["POST", { method: "POST", body: validInput, cookie: auth.cookie, csrf: "wrong-token" }],
    ["POST", { method: "POST", body: validInput, ...auth, origin: "https://evil.example.com" }],
    ["POST", { method: "POST", body: validInput, ...auth, origin: null }],
    ["PUT", { method: "PUT", body: validInput, cookie: auth.cookie }],
    ["PATCH", { method: "PATCH", body: { status: "closed" }, cookie: auth.cookie, csrf: "wrong-token" }],
    ["DELETE", { method: "DELETE", ...auth, origin: "https://evil.example.com" }],
  ];
  for (const [label, options] of attempts) {
    const path = label === "POST" ? "/staff/api/dialogue-events" : `/staff/api/dialogue-events/${created.id}`;
    const r = await call(env, path, options);
    assert.equal(r.res.status, 403, `${label} ${JSON.stringify({ ...options, cookie: undefined, csrf: options.csrf ? "(set)" : undefined })}`);
    assert.equal(r.reachedHandler, false);
    assert.deepEqual(r.json, { ok: false, error: "csrf_failed" });
  }
  const list = await call(env, "/staff/api/dialogue-events", auth);
  const events = (list.json as { events: DialogueEventRecord[] }).events;
  assert.equal(events.length, 1, "拒否された要求では何も変わらない");
  assert.equal(events[0].status, "open");
});

await test("8. 不正な status は拒否する", async () => {
  const env = makeEnv();
  const auth = await loginAs(env);
  const created = await createEvent(env, auth);
  for (const status of ["published", "受付中", "", null, 1, "OPEN"]) {
    const post = await call(env, "/staff/api/dialogue-events", { method: "POST", body: { ...validInput, status }, ...auth });
    assert.equal(post.res.status, 422, String(status));
    assert.ok((post.json as { fields: Record<string, string> }).fields.status);
    const patch = await call(env, `/staff/api/dialogue-events/${created.id}`, { method: "PATCH", body: { status }, ...auth });
    assert.equal(patch.res.status, 422, String(status));
  }
});

await test("9. 定員に不正な値を入れられない（0・負数・小数・文字・過大な値）", async () => {
  const env = makeEnv();
  const auth = await loginAs(env);
  for (const capacity of ["0", "-1", "1.5", "abc", "１０", "100000", 0, -5, 2.5, true, "20; DROP TABLE dialogue_events"]) {
    const r = await call(env, "/staff/api/dialogue-events", { method: "POST", body: { ...validInput, capacity }, ...auth });
    assert.equal(r.res.status, 422, String(capacity));
    assert.ok((r.json as { fields: Record<string, string> }).fields.capacity, String(capacity));
  }
  const empty = await createEvent(env, auth, { capacity: "" });
  assert.equal(empty.capacity, null, "空欄は定員なし");
  assert.equal((await createEvent(env, auth, { capacity: 10000 })).capacity, 10000);
});

await test("9b. その他の入力値検証（文字数・日時形式・制御文字・過大な本文・JSON以外）", () => {
  const cases: [Record<string, unknown>, string][] = [
    [{ title: "" }, "title"],
    [{ title: "あ".repeat(101) }, "title"],
    [{ venue: "   " }, "venue"],
    [{ venue: "会".repeat(101) }, "venue"],
    [{ address: "x".repeat(201) }, "address"],
    [{ description: "x".repeat(2001) }, "description"],
    [{ eventDate: "2026-02-30" }, "eventDate"],
    [{ eventDate: "2026/11/08" }, "eventDate"],
    [{ eventDate: "1999-01-01" }, "eventDate"],
    [{ startTime: "24:00" }, "startTime"],
    [{ startTime: "9:00" }, "startTime"],
    [{ endTime: "09:00" }, "endTime"],
    [{ endTime: "10:00" }, "endTime"],
    [{ title: "意見\u0000交換会" }, "title"],
    [{ title: "意見\u202E交換会" }, "title"],
    [{ title: ["配列"] }, "title"],
    [{ displayOrder: "99999" }, "displayOrder"],
    [{ applicationOpen: "yes" }, "applicationOpen"],
  ];
  for (const [override, field] of cases) {
    const result = validateDialogueInput({ ...validInput, ...override });
    assert.equal(result.ok, false, JSON.stringify(override));
    if (!result.ok) assert.ok(result.errors[field as keyof typeof result.errors], `${JSON.stringify(override)} → ${field}`);
  }
  const ok = validateDialogueInput({ ...validInput, title: "  意見交換会\n（南方）  ", description: "1行目\r\n2行目", endTime: "" });
  assert.ok(ok.ok);
  if (ok.ok) {
    assert.equal(ok.value.title, "意見交換会 （南方）", "1行の項目は改行を空白にまとめる");
    assert.equal(ok.value.description, "1行目\n2行目");
    assert.equal(ok.value.endTime, "");
  }
  assert.equal(validateDialogueInput("文字列").ok, false);
  assert.equal(validateDialogueInput(null).ok, false);
});

await test("9c. 過大なリクエスト・JSON以外・不正なIDは拒否する", async () => {
  const env = makeEnv();
  const auth = await loginAs(env);
  const big = await call(env, "/staff/api/dialogue-events", {
    method: "POST",
    rawBody: JSON.stringify({ ...validInput, description: "x".repeat(20000) }),
    ...auth,
  });
  assert.equal(big.res.status, 413);
  const form = await call(env, "/staff/api/dialogue-events", { method: "POST", rawBody: "title=x", contentType: "text/plain", ...auth });
  assert.equal(form.res.status, 415);
  const broken = await call(env, "/staff/api/dialogue-events", { method: "POST", rawBody: "{not json", ...auth });
  assert.equal(broken.res.status, 400);
  for (const id of ["0", "-1", "1.5", "abc", "1;DROP", "99999999999"]) {
    assert.equal((await call(env, `/staff/api/dialogue-events/${encodeURIComponent(id)}`, auth)).res.status, 404, id);
  }
});

await test("10. 公開ページへ反映される（下書き・削除済みは出さず、管理用の項目は読み出さない）", async () => {
  const env = makeEnv();
  const auth = await loginAs(env);
  await createEvent(env, auth, { title: "公開する回" });
  await createEvent(env, auth, { title: "下書きの回", isPublished: false });
  const events = await listPublicDialogueEvents(env.STAFF_DB);
  assert.deepEqual(events.map((e) => e.title), ["公開する回"]);
  assert.deepEqual(Object.keys(events[0]).sort(), [
    "address", "applicationOpen", "capacity", "description", "displayOrder", "endTime", "eventDate", "id", "startTime", "status", "title", "venue",
  ]);
  const html = renderDialogueSchedule(events, "2026-10-17");
  assert.ok(html.includes("公開する回"));
  assert.ok(!html.includes("下書きの回"));
  assert.ok(!html.includes("example.com"), "作成者のメールアドレスは公開しない");
  assert.ok(html.includes("2099年11月8日（日）"));
  assert.ok(html.includes("10:00～11:30"));
  assert.ok(html.includes("定員 20名"));
});

await test("11. 受付中は申込ボタンを出し、受付終了・申込停止中は出さない", () => {
  const open = renderDialogueSchedule([publicEvent()], "2026-10-17");
  assert.ok(open.includes("参加を申し込む"));
  assert.ok(open.includes('href="#dialogue-form" data-scroll-to-form'), "ページ内フォームへスクロール");
  const closed = renderDialogueSchedule([publicEvent({ status: "closed" })], "2026-10-17");
  assert.ok(!closed.includes("参加を申し込む"));
  assert.ok(closed.includes("受付終了"));
  const paused = renderDialogueSchedule([publicEvent({ applicationOpen: false })], "2026-10-17");
  assert.ok(!paused.includes("参加を申し込む"));
  assert.ok(paused.includes("お申し込み開始までお待ちください"));
});

await test("12. 日程調整中の表示が正しい", () => {
  const html = renderDialogueSchedule([publicEvent({ status: "scheduling" })], "2026-10-17");
  assert.ok(html.includes("日程調整中"));
  assert.ok(html.includes("現在、新しい意見交換会の日程を調整しています"));
  assert.ok(!html.includes("参加を申し込む"));
  assert.equal(renderDialogueSchemaScripts([publicEvent({ status: "scheduling" })], "2026-10-17"), "", "日程調整中は構造化データを出さない");
  const empty = renderDialogueSchedule([], "2026-10-17");
  assert.ok(empty.includes("意見交換会を随時開催していきます。"), "予定が無いときは随時開催の案内");
  assert.ok(empty.includes('href="/contact/"') && empty.includes("意見交換会について<wbr />問い合わせる"), "開催の希望はお問い合わせページへ案内する");
  assert.ok(!empty.includes("申込フォームから"));
});

await test("13. 開催済み・開催日を過ぎた回は「今後」に出さず「これまでの意見交換会」に表示する", () => {
  const html = renderDialogueSchedule(
    [
      publicEvent({ id: 1, title: "今後の回" }),
      publicEvent({ id: 2, title: "開催済みの回", status: "completed", eventDate: "2026-09-01" }),
      publicEvent({ id: 3, title: "日付が過ぎた回", eventDate: "2026-10-16" }),
    ],
    "2026-10-17",
  );
  const [upcoming, past] = html.split("これまでの意見交換会");
  assert.ok(upcoming.includes("今後の回"));
  assert.ok(!upcoming.includes("開催済みの回") && !upcoming.includes("日付が過ぎた回"));
  assert.ok(past.includes("開催済みの回") && past.includes("日付が過ぎた回"));
  assert.ok(past.indexOf("日付が過ぎた回") < past.indexOf("開催済みの回"), "これまでの回は新しい順");
  assert.ok(!past.includes("参加を申し込む"));
  const onlyPast = renderDialogueSchedule([publicEvent({ status: "completed", eventDate: "2026-09-01" })], "2026-10-17");
  assert.ok(onlyPast.includes("意見交換会を随時開催していきます。"), "今後の回が無ければ随時開催の案内");
});

await test("XSS対策：登録内容はHTMLエスケープし、構造化データからも抜け出せない", () => {
  const evil = publicEvent({
    title: '<script>alert(1)</script>',
    venue: '"><img src=x onerror=alert(1)>',
    address: "'onmouseover='alert(1)",
    description: "</script><script>alert(2)</script>",
  });
  const html = renderDialogueSchedule([evil], "2026-10-17");
  assert.ok(!html.includes("<script>"));
  assert.ok(!html.includes("<img"));
  assert.ok(html.includes("&lt;script&gt;alert(1)&lt;/script&gt;"));
  assert.ok(html.includes("&#39;onmouseover=&#39;"));
  const schema = renderDialogueSchemaScripts([evil], "2026-10-17");
  assert.equal(schema.match(/<\/script>/g)?.length, 1, "構造化データの<script>は1つだけ閉じる");
  assert.ok(!schema.includes("<img"));
  const json = JSON.parse(schema.replace(/^<script[^>]*>/, "").replace(/<\/script>$/, ""));
  assert.equal(json.name, "<script>alert(1)</script>｜福富千恵と延岡を動かす会", "値そのものは正しく読める");
  assert.equal(json.url, "https://nobeoka-ugokasu.pages.dev/dialogue/");
});

await test("migration：ファイルの定義が実行時の定義と一致し、何度実行しても既存テーブル・データを壊さない", async () => {
  const readStatements = (file: string) => {
    const text = readFileSync(new URL(`../../migrations/${file}`, import.meta.url), "utf8");
    const statements = text
      .split("\n")
      .filter((line) => !line.startsWith("--"))
      .join("\n")
      .split(";")
      .map((s) => s.trim())
      .filter(Boolean);
    return { text, statements };
  };
  const { text: sql, statements } = readStatements("0002_dialogue_events.sql");
  assert.deepEqual(statements, DIALOGUE_SCHEMA_SQL.map((s) => s.trim()));
  for (const file of ["0001_staff_sessions.sql", "0002_dialogue_events.sql"]) {
    for (const statement of readStatements(file).statements) {
      assert.match(statement, /^CREATE (TABLE|INDEX) IF NOT EXISTS /, `${file}: CREATE … IF NOT EXISTS だけを含む`);
    }
  }

  const env = makeEnv();
  const auth = await loginAs(env);
  await createEvent(env, auth);
  const db = env.STAFF_DB as unknown as FakeD1;
  for (let i = 0; i < 2; i++) db.sqlite.exec(sql);
  db.sqlite.exec(readFileSync(new URL("../../migrations/0001_staff_sessions.sql", import.meta.url), "utf8"));
  assert.equal((await db.prepare("SELECT COUNT(*) AS n FROM dialogue_events").first<{ n: number }>())!.n, 1);
  assert.equal((await db.prepare("SELECT COUNT(*) AS n FROM staff_sessions").first<{ n: number }>())!.n, 1, "セッションは消えない");
  assert.equal((await call(env, "/staff/api/dialogue-events", auth)).res.status, 200, "ログイン状態も維持");
});

Date.now = realNow;
console.log = realLog;
console.log(`\n${passed}件のテストに合格しました。`);
