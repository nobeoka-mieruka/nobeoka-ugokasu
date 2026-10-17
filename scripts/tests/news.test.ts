// 最新のお知らせ管理（/staff/news/・/staff/api/news-items）と、トップページ・/news/ の表示のテストです。
// D1はNode標準のSQLite（node:sqlite）で再現します。実際のGoogle・Cloudflareへは一切アクセスしません。
//
// 実行: npm run test:news

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { FakeD1 } from "./helpers/fakeD1";
import type { StaffAuthEnv } from "../../server/env";
import { createSession, resetSchemaCache } from "../../server/staffAuth";
import { NEWS_SCHEMA_SQL, listPublicNews, resetNewsSchemaCache, validateLinkUrl, validateNewsInput } from "../../server/newsItems";
import { resetDialogueSchemaCache, createDialogueEvent, listPublicDialogueEvents } from "../../server/dialogueEvents";
import { onRequest as staffMiddleware } from "../../functions/staff/_middleware";
import * as listApi from "../../functions/staff/api/news-items/index";
import * as itemApi from "../../functions/staff/api/news-items/[id]";
import { onRequestGet as editPage } from "../../functions/staff/news/[id]/edit";
import { mergeNews, renderHomeNews, renderNewsList } from "../../src/utils/newsCards";
import type { NewsDisplayItem, NewsItemRecord } from "../../src/types/news";

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
const TODAY = "2026-10-17";
const makeEnv = (db = new FakeD1()) =>
  ({
    STAFF_DB: db as unknown as D1Database,
    GOOGLE_CLIENT_ID: "test-client-id.apps.googleusercontent.com",
    GOOGLE_CLIENT_SECRET: "test-client-secret",
    STAFF_ALLOWED_EMAILS: STAFF,
  }) satisfies StaffAuthEnv;
type Env = ReturnType<typeof makeEnv>;
const fakeDb = (env: Env) => env.STAFF_DB as unknown as FakeD1;

const realNow = Date.now;
let timeOffsetMs = 0;
Date.now = () => realNow() + timeOffsetMs;

async function loginAs(env: Env) {
  const sessionId = await createSession(env.STAFF_DB, STAFF);
  const csrf = (await fakeDb(env).prepare("SELECT csrf_token FROM staff_sessions").first<{ csrf_token: string }>())!.csrf_token;
  return { cookie: `staff_session=${sessionId}`, csrf };
}

type Handler = (ctx: never) => Response | Promise<Response>;
const PAGE_HTML = "<html><body><h1>お知らせの管理</h1></body></html>";

function route(method: string, path: string): { handler: Handler | null; params: Record<string, string> } {
  if (path === "/staff/api/news-items") {
    return { handler: (method === "GET" ? listApi.onRequestGet : method === "POST" ? listApi.onRequestPost : null) as Handler | null, params: {} };
  }
  const item = /^\/staff\/api\/news-items\/([^/]+)$/.exec(path);
  if (item) {
    const handlers: Record<string, unknown> = { GET: itemApi.onRequestGet, PUT: itemApi.onRequestPut, PATCH: itemApi.onRequestPatch, DELETE: itemApi.onRequestDelete };
    return { handler: (handlers[method] ?? null) as Handler | null, params: { id: item[1] } };
  }
  const edit = /^\/staff\/news\/([^/]+)\/edit\/?$/.exec(path);
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

const validInput = {
  publishedOn: "2026-10-10",
  category: "activity_report",
  title: "駅前で街頭活動を行いました",
  summary: "多くの方にお声がけいただきました。ありがとうございました。",
  linkUrl: "/activities/",
  isPublished: true,
  displayOrder: "0",
};

async function createItem(env: Env, auth: { cookie: string; csrf: string }, overrides: Record<string, unknown> = {}) {
  const r = await call(env, "/staff/api/news-items", { method: "POST", body: { ...validInput, ...overrides }, ...auth });
  assert.equal(r.res.status, 201, r.text);
  return (r.json as { item: NewsItemRecord }).item;
}

async function listItems(env: Env, auth: { cookie: string; csrf: string }) {
  const r = await call(env, "/staff/api/news-items", auth);
  assert.equal(r.res.status, 200);
  return (r.json as { items: NewsItemRecord[] }).items;
}

/** ビルド時の /news/file-items.json と同じ内容（記事3件）。D1へ移行済みのため、配信時は表示されない */
const FILE_ITEMS: NewsDisplayItem[] = [
  { key: "article:2026-07-17-official-site-launch", date: "2026-07-17", title: "公式ホームページを公開しました", summary: "（記事）", category: "サイト更新", href: "/news/2026-07-17-official-site-launch/", displayOrder: 0 },
  { key: "article:2026-07-17-city-guide-diagnosis", date: "2026-07-17", title: "「延岡市役所 どこに行けばいい？診断」を公開しました", summary: "（記事）", category: "サイト更新", href: "/news/2026-07-17-city-guide-diagnosis/", displayOrder: 0 },
  { key: "article:2026-07-16-voices-collection-started", date: "2026-07-16", title: "「みんなの声」の募集を開始しました", summary: "（記事）", category: "お知らせ", href: "/news/2026-07-16-voices-collection-started/", displayOrder: 0 },
];

/** 移行前に本番の /news/ に表示されていた順番 */
const PRODUCTION_ORDER = [
  "ホームページを更新しました",
  "新たに看板を設置しました",
  "看板を設置しました",
  "「延岡市役所 どこに行けばいい？診断」を公開しました",
  "公式ホームページを公開しました",
  "「みんなの声」の募集を開始しました",
];

const titlesOf = (html: string) => [...html.matchAll(/<h3[^>]*>([^<]*)<\/h3>/g)].map((m) => m[1]);
async function publicHtml(env: Env, fileItems = FILE_ITEMS, today = TODAY) {
  const merged = mergeNews(await listPublicNews(env.STAFF_DB, today), fileItems, today);
  return { home: renderHomeNews(merged), list: renderNewsList(merged), merged };
}

let passed = 0;
async function test(name: string, fn: () => Promise<void> | void) {
  timeOffsetMs = 0;
  assetsRequested = [];
  resetSchemaCache();
  resetDialogueSchemaCache();
  resetNewsSchemaCache();
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
await test("1. 未ログインでは /staff/news/ に入れず、APIも内容を返さない", async () => {
  const env = makeEnv();
  for (const path of ["/staff/news/", "/staff/news/new/", "/staff/news/1/edit/"]) {
    const r = await call(env, path);
    assert.equal(r.res.status, 302, path);
    assert.equal(r.res.headers.get("Location"), "/staff/login/", path);
    assert.equal(r.reachedHandler, false, path);
  }
  assert.equal((await call(env, "/staff/api/news-items")).res.status, 401);
  assert.equal((await call(env, "/staff/api/news-items", { method: "POST", body: validInput })).res.status, 401);
  assert.equal((await call(env, "/staff/api/news-items/1", { method: "DELETE" })).res.status, 401);
});

await test("2. 既存のお知らせ6件がD1へ移行され、一覧に表示される（本番と同じ順番・重複なし）", async () => {
  const env = makeEnv();
  const auth = await loginAs(env);
  const items = await listItems(env, auth);
  assert.deepEqual(items.map((i) => i.title), PRODUCTION_ORDER);
  assert.ok(items.every((i) => i.sourceKey && i.isPublished && i.createdBy === "system:migration"));
  const { home, list } = await publicHtml(env);
  assert.deepEqual(titlesOf(list), PRODUCTION_ORDER, "記事と移行データが二重に表示されない");
  assert.deepEqual(titlesOf(home), PRODUCTION_ORDER.slice(0, 3), "トップページは最新3件（移行前と同じ）");
  const page = await call(env, "/staff/news/", auth);
  assert.equal(page.res.status, 200);
  assert.equal(page.res.headers.get("X-Robots-Tag"), "noindex, nofollow");
});

await test("3. 新規登録でき、作成者・操作ログが記録され、公開ページの先頭に出る", async () => {
  const env = makeEnv();
  const auth = await loginAs(env);
  logLines.length = 0;
  const item = await createItem(env, auth);
  assert.equal(item.createdBy, STAFF);
  assert.equal(item.sourceKey, null);
  const audit = await fakeDb(env).prepare("SELECT action, target_type, target_id, actor_email FROM staff_audit_log").all();
  assert.deepEqual(audit.results, [{ action: "news.create", target_type: "news_item", target_id: String(item.id), actor_email: STAFF }]);
  assert.ok(!logLines.join("\n").includes("example.com"), "サーバーログにメールアドレスを出さない");
  const { home } = await publicHtml(env);
  assert.deepEqual(titlesOf(home), ["駅前で街頭活動を行いました", "ホームページを更新しました", "新たに看板を設置しました"]);
});

await test("4. 編集でき、updated_at・updated_by と変更した項目が記録される", async () => {
  const env = makeEnv();
  const auth = await loginAs(env);
  const created = await createItem(env, auth);
  timeOffsetMs = 60_000;
  const r = await call(env, `/staff/api/news-items/${created.id}`, { method: "PUT", body: { ...validInput, title: "駅前で街頭活動を行いました（第2回）", category: "event" }, ...auth });
  assert.equal(r.res.status, 200, r.text);
  const updated = (r.json as { item: NewsItemRecord }).item;
  assert.equal(updated.title, "駅前で街頭活動を行いました（第2回）");
  assert.equal(updated.category, "event");
  assert.ok(updated.updatedAt >= created.updatedAt + 60);
  const audit = await fakeDb(env).prepare("SELECT detail FROM staff_audit_log WHERE action = 'news.update'").first<{ detail: string }>();
  assert.deepEqual(JSON.parse(audit!.detail).changed, ["category", "title"]);
  const edit = await call(env, `/staff/news/${created.id}/edit/`, auth);
  assert.equal(edit.res.status, 200);
  assert.deepEqual(assetsRequested, ["/staff/news/edit/"]);
  assert.equal((await call(env, "/staff/news/abc/edit/", auth)).res.status, 404);
});

await test("5. 削除（論理削除）すると公開ページから消え、移行データも記事として復活しない", async () => {
  const env = makeEnv();
  const auth = await loginAs(env);
  const items = await listItems(env, auth);
  const article = items.find((i) => i.sourceKey === "article:2026-07-17-official-site-launch")!;
  const signboard = items.find((i) => i.sourceKey === "news:2026-08-15-signboard-installed")!;
  for (const target of [article, signboard]) {
    assert.equal((await call(env, `/staff/api/news-items/${target.id}`, { method: "DELETE", ...auth })).res.status, 200);
  }
  // スキーマ作成（移行データの登録）をもう一度実行しても復活しない
  resetNewsSchemaCache();
  const { list } = await publicHtml(env);
  assert.ok(!titlesOf(list).includes("公式ホームページを公開しました"), "記事ファイル側から二重に復活しない");
  assert.ok(!titlesOf(list).includes("看板を設置しました"));
  assert.equal((await listItems(env, auth)).length, 4);
  const row = await fakeDb(env).prepare("SELECT deleted_by FROM news_items WHERE id = ?1").bind(article.id).first<{ deleted_by: string }>();
  assert.equal(row!.deleted_by, STAFF, "行は残り、削除した人が記録される");
  assert.equal((await call(env, `/staff/api/news-items/${article.id}`, { method: "DELETE", ...auth })).res.status, 404);
});

await test("6. 公開／非公開を切り替えられる（非公開は公開ページに出ない）", async () => {
  const env = makeEnv();
  const auth = await loginAs(env);
  const target = (await listItems(env, auth))[0];
  let r = await call(env, `/staff/api/news-items/${target.id}`, { method: "PATCH", body: { isPublished: false }, ...auth });
  assert.equal(r.res.status, 200);
  assert.equal((r.json as { item: NewsItemRecord }).item.isPublished, false);
  assert.ok(!titlesOf((await publicHtml(env)).list).includes(target.title));
  r = await call(env, `/staff/api/news-items/${target.id}`, { method: "PATCH", body: { isPublished: true }, ...auth });
  assert.ok(titlesOf((await publicHtml(env)).list).includes(target.title));
  for (const body of [{}, { isPublished: "yes" }, { isPublished: 1 }]) {
    assert.equal((await call(env, `/staff/api/news-items/${target.id}`, { method: "PATCH", body, ...auth })).res.status, 422);
  }
  const audit = await fakeDb(env).prepare("SELECT COUNT(*) AS n FROM staff_audit_log WHERE action = 'news.publish'").first<{ n: number }>();
  assert.equal(audit!.n, 2);
  // 非公開で新規登録
  const hidden = await createItem(env, auth, { title: "非公開のお知らせ", isPublished: false });
  assert.equal(hidden.isPublished, false);
  assert.ok(!titlesOf((await publicHtml(env)).list).includes("非公開のお知らせ"));
});

await test("7. CSRFトークン無し・不一致・別サイトからの更新要求は403", async () => {
  const env = makeEnv();
  const auth = await loginAs(env);
  const target = (await listItems(env, auth))[0];
  const attempts: [string, CallOptions][] = [
    ["/staff/api/news-items", { method: "POST", body: validInput, cookie: auth.cookie }],
    ["/staff/api/news-items", { method: "POST", body: validInput, cookie: auth.cookie, csrf: "wrong" }],
    ["/staff/api/news-items", { method: "POST", body: validInput, ...auth, origin: "https://evil.example.com" }],
    [`/staff/api/news-items/${target.id}`, { method: "PUT", body: validInput, ...auth, origin: null }],
    [`/staff/api/news-items/${target.id}`, { method: "PATCH", body: { isPublished: false }, cookie: auth.cookie }],
    [`/staff/api/news-items/${target.id}`, { method: "DELETE", cookie: auth.cookie, csrf: "wrong" }],
  ];
  for (const [path, options] of attempts) {
    const r = await call(env, path, options);
    assert.equal(r.res.status, 403, `${options.method} ${path}`);
    assert.equal(r.reachedHandler, false);
  }
  assert.equal((await listItems(env, auth)).length, 6, "拒否された要求では何も変わらない");
  assert.ok((await listItems(env, auth)).every((i) => i.isPublished));
});

await test("8. カテゴリー：新規登録で「サイト更新」は選べず、既存の「サイト更新」はそのまま編集できる", async () => {
  const env = makeEnv();
  const auth = await loginAs(env);
  for (const category of ["site_update", "サイト更新", "news", "", null]) {
    const r = await call(env, "/staff/api/news-items", { method: "POST", body: { ...validInput, category }, ...auth });
    assert.equal(r.res.status, 422, String(category));
    assert.ok((r.json as { fields: Record<string, string> }).fields.category);
  }
  for (const category of ["activity_report", "dialogue", "event", "notice"]) await createItem(env, auth, { category });
  const items = await listItems(env, auth);
  const siteUpdate = items.find((i) => i.sourceKey === "news:2026-09-07-site-update")!;
  assert.equal(siteUpdate.category, "site_update", "既存の「ホームページを更新しました」は削除せず残す");
  const keep = await call(env, `/staff/api/news-items/${siteUpdate.id}`, {
    method: "PUT",
    body: { publishedOn: siteUpdate.publishedOn, category: "site_update", title: siteUpdate.title, summary: siteUpdate.summary, linkUrl: siteUpdate.linkUrl, isPublished: true },
    ...auth,
  });
  assert.equal(keep.res.status, 200, "既存の「サイト更新」はそのまま保存できる");
  const other = items.find((i) => i.category === "activity_report")!;
  const change = await call(env, `/staff/api/news-items/${other.id}`, { method: "PUT", body: { ...validInput, category: "site_update" }, ...auth });
  assert.equal(change.res.status, 422, "他のお知らせを「サイト更新」には変更できない");
  const { list } = await publicHtml(env);
  assert.ok(list.includes(">イベント</span>") && list.includes(">意見交換会</span>") && list.includes(">お知らせ</span>"), "公開画面は日本語表示");
});

await test("9. リンク先：サイト内パスと http(s) のURLだけを許可し、危険なURLは拒否する", async () => {
  for (const ok of ["", "/activities/", "/dialogue/", "/news/2026-07-17-official-site-launch/", "https://www.facebook.com/122103979557398900/posts/122118395127398900", "https://example.com/a?b=c#d"]) {
    assert.notEqual(validateLinkUrl(ok), null, ok);
  }
  for (const bad of [
    "javascript:alert(1)",
    "JavaScript:alert(1)",
    "data:text/html,<script>alert(1)</script>",
    "//evil.example.com/",
    "/path with space",
    '/"><script>',
    "https://user:pass@example.com/",
    "ftp://example.com/",
    "vbscript:msgbox",
    "activities/",
    "https://" + "a".repeat(600),
  ]) {
    assert.equal(validateLinkUrl(bad), null, bad);
  }
  const r = validateNewsInput({ ...validInput, linkUrl: "javascript:alert(1)" });
  assert.equal(r.ok, false);
});

await test("9b. その他の入力値検証（文字数・日付・表示順・制御文字・過大な本文）", async () => {
  const cases: [Record<string, unknown>, string][] = [
    [{ title: "" }, "title"],
    [{ title: "あ".repeat(101) }, "title"],
    [{ summary: "" }, "summary"],
    [{ summary: "あ".repeat(301) }, "summary"],
    [{ publishedOn: "2026-02-30" }, "publishedOn"],
    [{ publishedOn: "2026/10/17" }, "publishedOn"],
    [{ displayOrder: "1.5" }, "displayOrder"],
    [{ displayOrder: "100000" }, "displayOrder"],
    [{ title: "お知らせ\u202Eです" }, "title"],
    [{ isPublished: "maybe" }, "isPublished"],
    [{ linkUrl: 123 }, "linkUrl"],
  ];
  for (const [override, field] of cases) {
    const result = validateNewsInput({ ...validInput, ...override });
    assert.equal(result.ok, false, JSON.stringify(override));
    if (!result.ok) assert.ok(result.errors[field as keyof typeof result.errors], `${JSON.stringify(override)} → ${field}`);
  }
  const env = makeEnv();
  const auth = await loginAs(env);
  const big = await call(env, "/staff/api/news-items", { method: "POST", rawBody: JSON.stringify({ ...validInput, summary: "x".repeat(20000) }), ...auth });
  assert.equal(big.res.status, 413);
  for (const id of ["0", "abc", "1;DROP"]) assert.equal((await call(env, `/staff/api/news-items/${id}`, auth)).res.status, 404, id);
});

await test("10. 公開ページ：掲載日の新しい順・表示順で優先・未来の掲載日は表示しない・新しい記事ファイルは自動で出る", async () => {
  const env = makeEnv();
  const auth = await loginAs(env);
  await createItem(env, auth, { title: "予約掲載のお知らせ", publishedOn: "2026-10-20" });
  await createItem(env, auth, { title: "優先表示のお知らせ", publishedOn: "2026-08-01", displayOrder: "-1" });
  const newArticle: NewsDisplayItem = { key: "article:2026-10-01-new", date: "2026-10-01", title: "新しい記事", summary: "記事", category: "お知らせ", href: "/news/2026-10-01-new/", displayOrder: 0 };
  const futureArticle: NewsDisplayItem = { ...newArticle, key: "article:future", title: "未来の記事", date: "2026-12-01" };
  const { home, list } = await publicHtml(env, [...FILE_ITEMS, newArticle, futureArticle]);
  assert.deepEqual(titlesOf(home), ["優先表示のお知らせ", "新しい記事", "ホームページを更新しました"]);
  assert.ok(!list.includes("予約掲載のお知らせ") && !list.includes("未来の記事"));
  const later = await publicHtml(env, FILE_ITEMS, "2026-10-20");
  assert.ok(titlesOf(later.list).includes("予約掲載のお知らせ"), "掲載日になれば表示される");
});

await test("11. SNS投稿の昇格分は、同じリンク先のお知らせがD1にあれば表示しない", async () => {
  const env = makeEnv();
  const social: NewsDisplayItem = {
    key: "social:1282455044943687_122118395127398900",
    date: "2026-08-25",
    title: "📣 新たに2か所、看板を設置しました！",
    summary: "…",
    category: "活動報告",
    href: "https://www.facebook.com/122103979557398900/posts/122118395127398900",
    displayOrder: 0,
  };
  const other = { ...social, key: "social:other", title: "別の投稿", href: "https://www.facebook.com/p/other" };
  const titles = titlesOf((await publicHtml(env, [...FILE_ITEMS, social, other])).list);
  assert.ok(!titles.includes(social.title), "D1の「新たに看板を設置しました」と同じリンク先なので出さない");
  assert.ok(titles.includes("別の投稿"));
});

await test("12. カードのデザインは従来どおり、外部リンクは別タブ＋rel=noopener noreferrer、XSSはエスケープ", async () => {
  const env = makeEnv();
  const auth = await loginAs(env);
  await createItem(env, auth, { title: '<img src=x onerror=alert(1)>', summary: '"><script>alert(1)</script>', linkUrl: "https://example.com/?a=1&b=2", publishedOn: "2026-10-16" });
  const { home } = await publicHtml(env);
  assert.ok(home.startsWith('<div class="grid gap-4 sm:grid-cols-3">'));
  assert.ok(home.includes('<a href="/news/" class="btn-secondary">お知らせ一覧を見る</a>'));
  assert.ok(!home.includes("<img") && !home.includes("<script>"));
  assert.ok(home.includes("&lt;img src=x onerror=alert(1)&gt;"));
  assert.ok(home.includes('href="https://example.com/?a=1&amp;b=2"'));
  const externalCard = home.match(/<a href="https:\/\/example\.com[^>]*>/)![0];
  assert.ok(externalCard.includes('target="_blank" rel="noopener noreferrer"'));
  assert.ok(home.includes("詳しく見る"), "SNS以外の外部リンクは「詳しく見る」");
  const fbCard = home.match(/<a href="https:\/\/www\.facebook\.com[^>]*>/)![0];
  assert.ok(fbCard.includes('rel="noopener noreferrer"'));
  assert.ok(home.includes("投稿を見る"), "SNS投稿へのリンクは従来どおり「投稿を見る」");
  const internal = home.match(/<a href="\/activities\/"[^>]*>/)![0];
  assert.ok(!internal.includes("target="), "サイト内リンクは同じタブ");
  assert.ok(home.includes('class="rounded-full bg-brand-orange-light px-2.5 py-1 font-bold text-ink">活動報告</span>'));
  assert.ok(home.includes('<time datetime="2026-09-07T00:00:00.000Z">2026年9月7日</time>'));
  assert.ok(renderHomeNews([]).includes("新しいお知らせは、公開次第こちらに掲載します。"));
  assert.ok(!renderHomeNews([]).includes("お知らせ一覧を見る"));
});

await test("migration：ファイルの定義が実行時の定義と一致し、何度実行しても既存テーブル・データを壊さない", async () => {
  const text = readFileSync(new URL("../../migrations/0003_news_items.sql", import.meta.url), "utf8");
  const statements = text
    .split("\n")
    .filter((line) => !line.startsWith("--"))
    .join("\n")
    .split(/;\n/)
    .map((s) => s.trim().replace(/;$/, ""))
    .filter(Boolean);
  assert.deepEqual(statements, NEWS_SCHEMA_SQL.map((s) => s.trim()));
  for (const s of statements) assert.match(s, /^(CREATE (TABLE|INDEX) IF NOT EXISTS |INSERT OR IGNORE INTO news_items )/);

  const env = makeEnv();
  const auth = await loginAs(env);
  const dialogue = await createDialogueEvent(env.STAFF_DB, {
    title: "意見交換会", eventDate: "2099-11-08", startTime: "10:00", endTime: "", venue: "公民館", address: "", description: "",
    capacity: null, status: "open", applicationOpen: true, isPublished: true, displayOrder: 0,
  }, STAFF);
  const edited = await createItem(env, auth);
  const db = fakeDb(env);
  for (let i = 0; i < 2; i++) db.sqlite.exec(text);
  assert.equal((await listItems(env, auth)).length, 7, "再実行しても移行データは増えない");
  assert.equal((await db.prepare("SELECT COUNT(*) AS n FROM staff_sessions").first<{ n: number }>())!.n, 1, "セッションは消えない");
  assert.deepEqual((await listPublicDialogueEvents(env.STAFF_DB)).map((e) => e.id), [dialogue.id], "意見交換会は消えない");
  assert.ok((await listItems(env, auth)).some((i) => i.id === edited.id));
});

Date.now = realNow;
console.log = realLog;
console.log(`\n${passed}件のテストに合格しました。`);
