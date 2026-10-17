// 資料管理（/staff/documents/・/staff/api/documents）のテストです。
// D1はNode標準のSQLite（node:sqlite）で再現します。登録するURLはすべて架空のものです。
//
// 実行: npm run test:documents

import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { captureLogs, controllableClock, createCaller, fakeDb, loginAs, makeEnv, testRunner, type Auth, type CallOptions, type Router } from "./helpers/staffHarness";
import { resetSchemaCache } from "../../server/staffAuth";
import { DOCUMENTS_SCHEMA_SQL, resetDocumentsSchemaCache, validateDocumentInput, validateDocumentUrl } from "../../server/documents";
import { detectDocumentType } from "../../src/utils/documentType";
import * as listApi from "../../functions/staff/api/documents/index";
import * as itemApi from "../../functions/staff/api/documents/[id]";
import { onRequestGet as editPage } from "../../functions/staff/documents/[id]/edit";
import type { DocumentRecord } from "../../src/types/documents";

const router: Router = (method, pathname) => {
  if (pathname === "/staff/api/documents") {
    return { handler: (method === "GET" ? listApi.onRequestGet : method === "POST" ? listApi.onRequestPost : null) as never, params: {} };
  }
  const item = /^\/staff\/api\/documents\/([^/]+)$/.exec(pathname);
  if (item) {
    const handlers: Record<string, unknown> = { GET: itemApi.onRequestGet, PUT: itemApi.onRequestPut, PATCH: itemApi.onRequestPatch, DELETE: itemApi.onRequestDelete };
    return { handler: (handlers[method] ?? null) as never, params: { id: item[1] } };
  }
  const edit = /^\/staff\/documents\/([^/]+)\/edit\/?$/.exec(pathname);
  if (edit) return { handler: editPage as never, params: { id: edit[1] } };
  return { handler: null, params: {} };
};
const { call, assetsRequested } = createCaller(router);
const clock = controllableClock();
const logs = captureLogs();

const DRIVE_URL = "https://drive.google.com/drive/folders/EXAMPLE-FOLDER-ID-0000";
const validInput = {
  title: "第1回 執行部会議 議事録",
  category: "meeting",
  description: "10月の会議の議事録です。",
  url: "https://docs.google.com/document/d/EXAMPLE-DOC-ID-0000/edit",
  documentType: "auto",
  pinned: false,
  displayOrder: "0",
};

type Env = ReturnType<typeof makeEnv>;
async function create(env: Env, auth: Auth, overrides: Record<string, unknown> = {}) {
  const r = await call(env, "/staff/api/documents", { method: "POST", body: { ...validInput, ...overrides }, ...auth });
  assert.equal(r.res.status, 201, r.text);
  return (r.json as { document: DocumentRecord }).document;
}
const list = async (env: Env, auth: Auth) => ((await call(env, "/staff/api/documents", auth)).json as { documents: DocumentRecord[] }).documents;
const auditRows = async (env: Env) =>
  (await fakeDb(env).prepare("SELECT action, detail FROM staff_audit_log WHERE target_type = 'document' ORDER BY id").all<{ action: string; detail: string }>()).results;

const { test, done } = testRunner(() => {
  clock.reset();
  logs.lines.length = 0;
  assetsRequested.length = 0;
  resetSchemaCache();
  resetDocumentsSchemaCache();
});

// =========================================================
await test("1. 未ログインでは /staff/documents/ に入れず、資料の一覧も返さない", async () => {
  const env = makeEnv();
  for (const p of ["/staff/documents/", "/staff/documents/new/", "/staff/documents/1/edit/"]) {
    const r = await call(env, p);
    assert.equal(r.res.status, 302, p);
    assert.equal(r.res.headers.get("Location"), "/staff/login/");
    assert.equal(r.reachedHandler, false);
  }
  for (const [method, p] of [["GET", "/staff/api/documents"], ["POST", "/staff/api/documents"], ["DELETE", "/staff/api/documents/1"]]) {
    const r = await call(env, p, { method, body: method === "GET" ? undefined : validInput });
    assert.equal(r.res.status, 401, `${method} ${p}`);
    assert.ok(!r.text.includes("docs.google.com"));
  }
});

await test("2. 登録でき、URLから種類を自動判定する（Google Drive・ドキュメント・スプレッドシート・PDF・Webリンク）", async () => {
  const env = makeEnv();
  const auth = await loginAs(env);
  const cases: [string, string][] = [
    [DRIVE_URL, "google_drive"],
    ["https://drive.google.com/file/d/EXAMPLE-FILE/view", "google_drive"],
    ["https://docs.google.com/document/d/EXAMPLE/edit", "google_docs"],
    ["https://docs.google.com/spreadsheets/d/EXAMPLE/edit#gid=0", "google_sheets"],
    ["https://example.com/files/report.PDF", "pdf"],
    ["https://example.com/page", "web"],
    ["https://docs.google.com/presentation/d/EXAMPLE/edit", "other"],
  ];
  for (const [url, type] of cases) {
    assert.equal(detectDocumentType(url), type, url);
    const doc = await create(env, auth, { url, title: `資料 ${type}` });
    assert.equal(doc.documentType, type, url);
  }
  const manual = await create(env, auth, { url: "https://example.com/page", documentType: "pdf" });
  assert.equal(manual.documentType, "pdf", "手動で選んだ種類を優先");
  const drive = (await list(env, auth)).find((d) => d.url === DRIVE_URL)!;
  assert.equal(drive.createdBy, "staff@example.com");
});

await test("3. 危険なURL・https以外は拒否する（javascript:・data:・file:・http: など）", async () => {
  for (const bad of [
    "javascript:alert(1)",
    "JAVASCRIPT:alert(1)",
    " javascript:alert(1)",
    "data:text/html,<script>alert(1)</script>",
    "file:///C:/secret.txt",
    "http://example.com/",
    "ftp://example.com/a.pdf",
    "//drive.google.com/x",
    "drive.google.com/x",
    "https://user:pass@example.com/",
    "https://example.com/a b",
    "https://" + "a".repeat(2001),
    "",
    123,
  ]) {
    assert.equal(validateDocumentUrl(bad), null, String(bad).slice(0, 40));
  }
  const env = makeEnv();
  const auth = await loginAs(env);
  const r = await call(env, "/staff/api/documents", { method: "POST", body: { ...validInput, url: "javascript:alert(1)" }, ...auth });
  assert.equal(r.res.status, 422);
  assert.ok((r.json as { fields: Record<string, string> }).fields.url);
  assert.deepEqual(await list(env, auth), []);
});

await test("4. 編集・ピン留め・削除（論理削除）ができ、操作ログには項目名だけを残す（URL・説明は残さない）", async () => {
  const env = makeEnv();
  const auth = await loginAs(env);
  const doc = await create(env, auth);
  clock.advance(60_000);
  const r = await call(env, `/staff/api/documents/${doc.id}`, { method: "PUT", body: { ...validInput, title: "議事録（修正版）", url: DRIVE_URL, category: "supporters" }, ...auth });
  assert.equal(r.res.status, 200, r.text);
  const updated = (r.json as { document: DocumentRecord }).document;
  assert.deepEqual([updated.title, updated.documentType, updated.category], ["議事録（修正版）", "google_drive", "supporters"]);
  assert.ok(updated.updatedAt >= doc.updatedAt + 60);
  const pin = await call(env, `/staff/api/documents/${doc.id}`, { method: "PATCH", body: { pinned: true }, ...auth });
  assert.equal((pin.json as { document: DocumentRecord }).document.pinned, true);
  assert.equal((await call(env, `/staff/api/documents/${doc.id}`, { method: "PATCH", body: { pinned: "yes" }, ...auth })).res.status, 422);
  assert.equal((await call(env, `/staff/api/documents/${doc.id}`, { method: "DELETE", ...auth })).res.status, 200);
  assert.deepEqual(await list(env, auth), []);
  const row = await fakeDb(env).prepare("SELECT deleted_by FROM staff_documents WHERE id = ?1").bind(doc.id).first<{ deleted_by: string }>();
  assert.equal(row!.deleted_by, "staff@example.com", "行は残る");
  const audit = await auditRows(env);
  assert.deepEqual(audit.map((a) => a.action), ["document.create", "document.update", "document.pin", "document.delete"]);
  assert.deepEqual(JSON.parse(audit[1].detail).changed, ["title", "category", "url", "documentType"]);
  const text = JSON.stringify(audit) + logs.lines.join("\n");
  for (const secret of ["drive.google.com", "docs.google.com", "10月の会議の議事録", "example.com"]) assert.ok(!text.includes(secret), secret);
  const edit = await call(env, `/staff/documents/${doc.id}/edit/`, auth);
  assert.equal(edit.res.status, 200);
  assert.deepEqual(assetsRequested, ["/staff/documents/edit/"]);
});

await test("5. 一覧の並び：ピン留め → 表示順 → 更新の新しい順", async () => {
  const env = makeEnv();
  const auth = await loginAs(env);
  await create(env, auth, { title: "A" });
  clock.advance(1000);
  await create(env, auth, { title: "B" });
  await create(env, auth, { title: "C", pinned: true });
  await create(env, auth, { title: "D", displayOrder: "-1" });
  assert.deepEqual((await list(env, auth)).map((d) => d.title), ["C", "D", "B", "A"]);
});

await test("6. CSRFトークン無し・不一致・別サイトからの更新要求は403", async () => {
  const env = makeEnv();
  const auth = await loginAs(env);
  const doc = await create(env, auth);
  const attempts: [string, CallOptions][] = [
    ["/staff/api/documents", { method: "POST", body: validInput, cookie: auth.cookie }],
    ["/staff/api/documents", { method: "POST", body: validInput, ...auth, origin: "https://evil.example.com" }],
    [`/staff/api/documents/${doc.id}`, { method: "PUT", body: validInput, cookie: auth.cookie, csrf: "wrong" }],
    [`/staff/api/documents/${doc.id}`, { method: "PATCH", body: { pinned: true }, ...auth, origin: null }],
    [`/staff/api/documents/${doc.id}`, { method: "DELETE", cookie: auth.cookie }],
  ];
  for (const [p, options] of attempts) {
    const r = await call(env, p, options);
    assert.equal(r.res.status, 403, `${options.method} ${p}`);
    assert.equal(r.reachedHandler, false);
  }
  const docs = await list(env, auth);
  assert.deepEqual(docs.map((d) => [d.title, d.pinned]), [[validInput.title, false]], "拒否された要求では何も変わらない");
});

await test("7. 入力値検証（タイトル・説明の文字数・カテゴリー・種類・表示順・過大な本文・不正なID）", async () => {
  const cases: [Record<string, unknown>, string][] = [
    [{ title: "" }, "title"],
    [{ title: "あ".repeat(101) }, "title"],
    [{ description: "x".repeat(1001) }, "description"],
    [{ category: "secret" }, "category"],
    [{ category: "会議資料" }, "category"],
    [{ documentType: "exe" }, "documentType"],
    [{ displayOrder: "1.5" }, "displayOrder"],
    [{ pinned: "maybe" }, "pinned"],
    [{ title: "資料\u202Eです" }, "title"],
  ];
  for (const [override, field] of cases) {
    const r = validateDocumentInput({ ...validInput, ...override });
    assert.equal(r.ok, false, JSON.stringify(override));
    if (!r.ok) assert.ok(r.errors[field as keyof typeof r.errors], `${JSON.stringify(override)} → ${field}`);
  }
  for (const category of ["supporters", "meeting", "event", "dialogue", "pr", "election", "other"]) assert.ok(validateDocumentInput({ ...validInput, category }).ok, category);
  const env = makeEnv();
  const auth = await loginAs(env);
  assert.equal((await call(env, "/staff/api/documents", { method: "POST", rawBody: JSON.stringify({ ...validInput, description: "x".repeat(20000) }), ...auth })).res.status, 413);
  for (const id of ["0", "abc", "1;DROP"]) assert.equal((await call(env, `/staff/api/documents/${id}`, auth)).res.status, 404, id);
});

await test("8. 「資料を開く」は新しいタブ＋rel=noopener noreferrer。共有設定の注意書きを表示する（ビルド済みファイルを検査）", () => {
  const page = new URL("../../dist/staff/documents/index.html", import.meta.url);
  assert.ok(existsSync(page), "npm run build の後に実行");
  const html = readFileSync(page, "utf8");
  const openLinks = [...html.matchAll(/<a data-open-link[^>]*>/g)].map((m) => m[0]);
  assert.equal(openLinks.length, 2, "表・カードの両方");
  for (const link of openLinks) assert.ok(link.includes('target="_blank"') && link.includes('rel="noopener noreferrer"'), link);
  assert.ok(html.includes("必要な方のGoogleアカウントだけに共有"), "Google Drive の共有設定の注意書き");
  assert.ok(readFileSync(new URL("../../dist/staff/documents/new/index.html", import.meta.url), "utf8").includes("必要な方のGoogleアカウントだけに共有"));
});

await test("9. 資料は公開ページ・公開用の処理・サイトマップ・ビルド済みファイルに出ない", () => {
  for (const file of ["functions/index.ts", "functions/news/index.ts", "functions/events/index.ts", "functions/dialogue/index.ts", "server/publicRewrite.ts", "server/newsPublic.ts", "server/eventsPublic.ts"]) {
    assert.ok(!readFileSync(new URL(`../../${file}`, import.meta.url), "utf8").includes("documents"), file);
  }
  const distDir = decodeURIComponent(new URL("../../dist/", import.meta.url).pathname).replace(/^\/([A-Za-z]:)/, "$1");
  const walk = (dir: string): string[] => readdirSync(dir).flatMap((name) => (statSync(path.join(dir, name)).isDirectory() ? walk(path.join(dir, name)) : [path.join(dir, name)]));
  const files = walk(distDir);
  for (const file of files.filter((f) => f.endsWith(".html") && !f.includes(`${path.sep}staff${path.sep}`))) {
    const html = readFileSync(file, "utf8");
    assert.ok(!html.includes("/staff/api/documents") && !html.includes("staff_documents"), file);
  }
  for (const file of files.filter((f) => f.endsWith(".xml"))) assert.ok(!readFileSync(file, "utf8").includes("/staff/"), file);
});

await test("migration：ファイルの定義が実行時の定義と一致し、何度実行しても既存テーブル・データを壊さない", async () => {
  const text = readFileSync(new URL("../../migrations/0007_staff_documents.sql", import.meta.url), "utf8");
  const statements = text
    .split("\n")
    .filter((line) => !line.startsWith("--"))
    .join("\n")
    .split(/;\n/)
    .map((s) => s.trim().replace(/;$/, ""))
    .filter(Boolean);
  assert.deepEqual(statements, DOCUMENTS_SCHEMA_SQL.map((s) => s.trim()));
  for (const s of statements) assert.match(s, /^CREATE (TABLE|INDEX) IF NOT EXISTS /);
  const env = makeEnv();
  const auth = await loginAs(env);
  await create(env, auth);
  for (let i = 0; i < 2; i++) fakeDb(env).sqlite.exec(text);
  assert.equal((await list(env, auth)).length, 1);
  assert.equal((await fakeDb(env).prepare("SELECT COUNT(*) AS n FROM staff_sessions").first<{ n: number }>())!.n, 1);
});

logs.restore();
clock.restore();
done();
