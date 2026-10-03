// SNS同期（server/socialSync.ts）・画像配信（functions/api/social-image.ts）・公開API
//（server/socialFeed.ts）の動作確認テストです。SNSのAPI・画像CDN・Cloudflare KVはすべて
// テスト内の偽物（モック）に置き換え、実際のSNSへは一切アクセスしません。
//
// 実行: npm run test:social

import assert from "node:assert/strict";
import sharp from "sharp";
import type { SocialSyncEnv } from "../../server/env";
import { runSocialSync } from "../../server/socialSync";
import { getSocialFeed } from "../../server/socialFeed";
import { readImageSize } from "../../server/socialImages";
import { onRequestGet as socialImageGet } from "../../functions/api/social-image";
import { onRequestPost as adminSyncPost } from "../../functions/api/admin/sync-social-posts";

// ---- 偽のKV ----
class MemoryKV {
  store = new Map<string, { value: string | Uint8Array; metadata: unknown }>();
  puts: string[] = [];
  async get(key: string, type?: string) {
    const entry = this.store.get(key);
    if (!entry) return null;
    if (type === "json") return JSON.parse(entry.value as string);
    return entry.value;
  }
  async getWithMetadata(key: string, type?: string) {
    const entry = this.store.get(key);
    if (!entry) return { value: null, metadata: null };
    const v = entry.value;
    const value = type === "arrayBuffer" && v instanceof Uint8Array ? v.buffer.slice(v.byteOffset, v.byteOffset + v.byteLength) : v;
    return { value, metadata: entry.metadata };
  }
  async put(key: string, value: string | Uint8Array, options?: { metadata?: unknown }) {
    this.puts.push(key);
    this.store.set(key, { value, metadata: options?.metadata ?? null });
  }
}

// ---- テスト用の画像（横長・縦長・正方形） ----
const jpeg = (w: number, h: number) =>
  sharp({ create: { width: w, height: h, channels: 3, background: { r: 230, g: 120, b: 40 } } }).jpeg().toBuffer();
const landscape = await jpeg(720, 480);
const portrait = await jpeg(540, 720);
const square = await jpeg(600, 600);
const png = await sharp({ create: { width: 320, height: 200, channels: 4, background: "#fff" } }).png().toBuffer();

const LONG_TEXT = `${"延岡の地域活動について。".repeat(40)}\n詳しくは https://example.com/very/long/path/that/should/wrap/${"x".repeat(80)} をご覧ください🎉😊📣`;

// ---- 偽のSNS API・画像CDN ----
let facebookMode: "ok" | "error" = "ok";
let instagramMode: "ok" | "error" = "error";
let threadsMode: "ok" | "error" = "ok";
const imageFetches: string[] = [];
const cdn = (name: string) => `https://scontent-nrt1-1.xx.fbcdn.net/v/t39/${name}.jpg?oe=6AA3D6F0&_nc_ohc=SIGNED&oh=00_SECRETISH`;

const facebookPosts = () => [
  { id: "page_1", message: "📣 看板を設置しました！\n\n#延岡", created_time: "2026-10-01T10:00:00+0000", permalink_url: "https://www.facebook.com/p/1", full_picture: cdn("landscape"), attachments: { data: [{ media_type: "photo" }] } },
  { id: "page_2", message: LONG_TEXT, created_time: "2026-09-30T10:00:00+0000", permalink_url: "https://www.facebook.com/p/2" },
  {
    id: "page_3",
    message: "アルバム投稿",
    created_time: "2026-09-29T10:00:00+0000",
    permalink_url: "https://www.facebook.com/p/3",
    full_picture: cdn("portrait"),
    attachments: { data: [{ media_type: "album", subattachments: { data: [{}, {}, {}] } }] },
  },
  { id: "page_4", message: "画像が取得できない投稿", created_time: "2026-09-28T10:00:00+0000", permalink_url: "https://www.facebook.com/p/4", full_picture: cdn("missing") },
  // 同じ投稿がAPIから重複して返ってきた場合
  { id: "page_1", message: "📣 看板を設置しました！\n\n#延岡", created_time: "2026-10-01T10:00:00+0000", permalink_url: "https://www.facebook.com/p/1", full_picture: cdn("landscape") },
];

const threadsPosts = () => [
  {
    id: "th_1",
    media_type: "CAROUSEL_ALBUM",
    text: "カルーセル（先頭が動画）",
    permalink: "https://www.threads.net/@x/post/1",
    timestamp: "2026-10-02T09:00:00+0000",
    children: { data: [{ media_type: "VIDEO", media_url: "https://scontent.cdninstagram.com/v/clip.mp4", thumbnail_url: "https://scontent.cdninstagram.com/v/square.jpg?oe=1" }, { media_type: "IMAGE", media_url: "https://scontent.cdninstagram.com/v/landscape.jpg" }] },
  },
  { id: "th_2", media_type: "VIDEO", text: "サムネイルの無い動画", permalink: "https://www.threads.net/@x/post/2", timestamp: "2026-10-02T08:00:00+0000", media_url: "https://scontent.cdninstagram.com/v/video.mp4" },
  { id: "th_3", media_type: "TEXT_POST", text: "テキストだけの投稿です。", permalink: "https://www.threads.net/@x/post/3", timestamp: "2026-10-02T07:00:00+0000" },
];

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const graphError = () => json({ error: { message: "Error validating access token: Session has expired", type: "OAuthException", code: 190, error_subcode: 463 } }, 400);

globalThis.fetch = (async (input: RequestInfo | URL) => {
  const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url);
  if (url.hostname === "graph.facebook.com" && url.pathname.endsWith("/published_posts")) return facebookMode === "ok" ? json({ data: facebookPosts() }) : graphError();
  if (url.hostname === "graph.facebook.com" && url.pathname.endsWith("/media")) return instagramMode === "ok" ? json({ data: [] }) : graphError();
  if (url.hostname === "graph.threads.net") return threadsMode === "ok" ? json({ data: threadsPosts() }) : graphError();
  imageFetches.push(url.pathname);
  const images: Record<string, Buffer> = { landscape, portrait, square };
  const name = url.pathname.split("/").pop()!.replace(/\.(jpg|mp4)$/, "");
  if (url.pathname.endsWith(".mp4")) return new Response("video", { headers: { "Content-Type": "video/mp4" } });
  const bytes = images[name];
  if (!bytes) return new Response("forbidden", { status: 403 });
  return new Response(bytes, { headers: { "Content-Type": "image/jpeg", "Content-Length": String(bytes.byteLength) } });
}) as typeof fetch;

const kv = new MemoryKV();
const env = {
  SOCIAL_POSTS_KV: kv as unknown as KVNamespace,
  FACEBOOK_PAGE_ID: "123",
  INSTAGRAM_USER_ID: "456",
  META_ACCESS_TOKEN: "TOKEN_SHOULD_NEVER_APPEAR_1234567890",
  THREADS_USER_ID: "789",
  THREADS_ACCESS_TOKEN: "THREADS_TOKEN_SHOULD_NEVER_APPEAR_123",
  SOCIAL_CRON_SECRET: "cron-secret-for-test",
} satisfies Partial<SocialSyncEnv> as SocialSyncEnv;

let passed = 0;
async function test(name: string, fn: () => Promise<void> | void) {
  try {
    await fn();
    passed++;
    console.log(`✓ ${name}`);
  } catch (err) {
    console.error(`✗ ${name}`);
    throw err;
  }
}

const silence = <T>(fn: () => Promise<T>) => {
  const warn = console.warn;
  console.warn = () => {};
  return fn().finally(() => (console.warn = warn));
};

// ---- 1回目の同期 ----
const first = await silence(() => runSocialSync(env));
const byId = (id: string) => first.posts.find((p) => p.id === id)!;

await test("Instagramの取得失敗がFacebook・Threadsへ波及しない（SNSごとの障害分離）", () => {
  assert.equal(first.ok, true);
  assert.deepEqual(first.status, { facebook: "ok", instagram: "error", threads: "ok" });
});

await test("同じ投稿の重複登録を防ぐ", () => {
  assert.equal(first.posts.filter((p) => p.id === "page_1").length, 1);
  assert.equal(first.posts.length, 7);
});

await test("画像あり投稿：画像をKVへ保存し、自社ドメインのURLで配信する", () => {
  const post = byId("page_1");
  assert.match(post.localImage!.src, /^\/api\/social-image\?k=facebook_page_1_[0-9a-f]{8}$/);
  assert.deepEqual([post.localImage!.width, post.localImage!.height], [720, 480]);
});

await test("画像なし投稿・長文・URL・絵文字を含む投稿", () => {
  const post = byId("page_2");
  assert.equal(post.localImage, null);
  assert.equal(post.description, LONG_TEXT);
  assert.ok(post.title.length <= 43);
  assert.ok(post.description.includes("🎉😊📣") && post.description.includes("https://example.com/"));
  assert.equal(byId("th_3").localImage, null);
});

await test("複数画像投稿：先頭画像と枚数（縦長画像の寸法も取得）", () => {
  const album = byId("page_3");
  assert.equal(album.mediaCount, 3);
  assert.deepEqual([album.localImage!.width, album.localImage!.height], [540, 720]);
  const carousel = byId("th_1");
  assert.equal(carousel.mediaCount, 2);
  assert.match(carousel.localImage!.src, /threads_th_1_/);
});

await test("動画のmp4を画像として扱わない（サムネイルが無い動画は画像なし）", () => {
  assert.equal(byId("th_2").localImage, null);
  assert.ok(!imageFetches.some((p) => p.endsWith(".mp4")));
});

await test("画像取得失敗（403）の投稿は画像なしとして表示し、他の投稿は正常", () => {
  assert.equal(byId("page_4").localImage, null);
  assert.equal(first.imagesFailed, 1);
  assert.equal(first.imagesDownloaded, 3);
});

await test("公開APIにSNS側の期限付きURL・トークンが含まれない", async () => {
  const feed = await getSocialFeed(env);
  const text = JSON.stringify(feed);
  for (const forbidden of ["fbcdn.net", "cdninstagram.com", "oe=", "SECRETISH", "TOKEN_SHOULD_NEVER_APPEAR", "imageSource"]) {
    assert.ok(!text.includes(forbidden), `公開APIに ${forbidden} が含まれている`);
  }
  assert.equal(feed.posts.length, 7);
  assert.equal(feed.fetchFailed, false);
  assert.ok(feed.updatedAt && feed.checkedAt);
});

// ---- 2回目（内容に変化なし） ----
await test("変化が無ければ投稿一覧を書き込まず、保存済み画像も再ダウンロードしない", async () => {
  kv.puts = [];
  const before = imageFetches.length;
  const second = await silence(() => runSocialSync(env));
  assert.equal(second.changed, false);
  assert.ok(!kv.puts.includes("social-posts:cache:v1"));
  assert.ok(kv.puts.includes("social-posts:heartbeat:v1"));
  // 取得に失敗した page_4 の画像だけは次回も取得を試みる
  assert.deepEqual(imageFetches.slice(before), ["/v/t39/missing.jpg"]);
});

// ---- Facebookだけ失敗 ----
await test("Facebook取得失敗時は直前の投稿と保存済み画像を引き継ぎ（last known good）、Threadsは更新される", async () => {
  facebookMode = "error";
  const before = imageFetches.length;
  const third = await silence(() => runSocialSync(env));
  assert.equal(third.status.facebook, "error");
  assert.equal(third.status.threads, "ok");
  const carried = third.posts.find((p) => p.id === "page_1")!;
  assert.match(carried.localImage!.src, /facebook_page_1_/);
  assert.equal(imageFetches.length, before, "引き継いだ投稿の期限切れURLを再取得していない");
});

// ---- 全SNS失敗 ----
await test("全SNSが失敗しても保存済みの投稿は消えず、fetchFailedになる", async () => {
  threadsMode = "error";
  kv.puts = [];
  const result = await silence(() => runSocialSync(env));
  assert.equal(result.ok, false);
  assert.equal(result.skippedReason, "all_platforms_failed");
  assert.ok(!kv.puts.includes("social-posts:cache:v1"));
  const feed = await getSocialFeed(env);
  assert.equal(feed.posts.length, 7);
  assert.equal(feed.fetchFailed, true);
});

// ---- 画像配信エンドポイント ----
const callImage = (k: string) =>
  socialImageGet({ request: new Request(`https://example.com/api/social-image?k=${k}`), env } as unknown as Parameters<PagesFunction<SocialSyncEnv>>[0]);

await test("/api/social-image：保存済み画像を長期キャッシュ付きで返す", async () => {
  const k = byId("page_1").localImage!.src.split("k=")[1];
  const res = await callImage(k);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("Content-Type"), "image/jpeg");
  assert.equal(res.headers.get("Cache-Control"), "public, max-age=31536000, immutable");
  assert.equal((await res.arrayBuffer()).byteLength, landscape.byteLength);
});

await test("/api/social-image：不正・未保存のIDは404（任意URLのプロキシにならない）", async () => {
  assert.equal((await callImage("facebook_page_9_0000abcd")).status, 404);
  assert.equal((await callImage(encodeURIComponent("https://evil.example/x.jpg"))).status, 404);
  assert.equal((await callImage("../../etc")).status, 404);
});

await test("/api/admin/sync-social-posts：秘密キーが無い・違う場合は401", async () => {
  const call = (auth?: string) =>
    adminSyncPost({
      request: new Request("https://example.com/api/admin/sync-social-posts", { method: "POST", headers: auth ? { Authorization: auth } : {} }),
      env,
    } as unknown as Parameters<PagesFunction<SocialSyncEnv>>[0]);
  assert.equal((await call()).status, 401);
  assert.equal((await call("Bearer wrong")).status, 401);
  const ok = await silence(() => call("Bearer cron-secret-for-test"));
  assert.equal(ok.status, 200);
  const body = await ok.text();
  assert.ok(!body.includes("TOKEN_SHOULD_NEVER_APPEAR") && !body.includes("Session has expired"));
});

await test("画像サイズの読み取り（JPEG横長・縦長・正方形、PNG）", () => {
  assert.deepEqual(readImageSize(new Uint8Array(landscape)), { width: 720, height: 480 });
  assert.deepEqual(readImageSize(new Uint8Array(portrait)), { width: 540, height: 720 });
  assert.deepEqual(readImageSize(new Uint8Array(square)), { width: 600, height: 600 });
  assert.deepEqual(readImageSize(new Uint8Array(png)), { width: 320, height: 200 });
});

console.log(`\n${passed}件のテストに合格しました。`);
