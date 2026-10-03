// ビルド前（predev/prebuild）に実行し、SNS投稿をビルド時のHTMLへ書き出すためのデータを用意します。
//
//   1. 本番サイトの公開API（/api/social-feed）から、定期同期済みの投稿一覧を取得する
//      （SNSのAPIを直接呼ぶのは定期同期だけ。ビルドにはアクセストークンは不要）
//   2. src/data/socialPostsSnapshot.json へ書き出す（トップページ・活動報告ページがSSRに使う）
//   3. public/social-build-manifest.json へ、ビルドした内容の署名を書き出す
//      （定期チェック（GitHub Actions）が、本番APIの内容と比べて変化があるときだけ再ビルドするため）
//
// 画像は、定期同期がサイト側に保存した /api/social-image?k=... だけを使います。
// SNS側の画像URL（時間が経つと無効になる署名付きURL）はスナップショットへ一切残しません。
//
// 取得に失敗した場合でもビルド全体は止めず、直前のスナップショットをそのまま使います
//（その場合も、期限付きの画像URLは取り除いてから書き出します）。

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { postsSignature } from "./social-signature.mjs";

const rootDir = path.resolve(fileURLToPath(import.meta.url), "../..");
const snapshotPath = path.join(rootDir, "src", "data", "socialPostsSnapshot.json");
const manifestPath = path.join(rootDir, "public", "social-build-manifest.json");

const DEFAULT_FEED_URL = "https://nobeoka-ugokasu.pages.dev/api/social-feed";
const FETCH_TIMEOUT_MS = 10000;
const PLATFORMS = new Set(["facebook", "instagram", "threads"]);

function readExistingSnapshot() {
  if (!existsSync(snapshotPath)) return { posts: [], fetchedAt: null };
  try {
    const parsed = JSON.parse(readFileSync(snapshotPath, "utf8"));
    return { posts: Array.isArray(parsed.posts) ? parsed.posts : [], fetchedAt: parsed.fetchedAt ?? null };
  } catch {
    return { posts: [], fetchedAt: null };
  }
}

/** 表示に必要な項目だけを残し、期限付きの画像URLや内部用の値を取り除く */
function sanitizePost(post) {
  if (!post || typeof post.id !== "string" || !PLATFORMS.has(post.platform) || typeof post.permalink !== "string") return null;
  const local = post.localImage;
  const localImage =
    local && typeof local.src === "string" && local.src.startsWith("/api/social-image?k=")
      ? { src: local.src, width: Number(local.width) || 0, height: Number(local.height) || 0 }
      : null;
  return {
    id: post.id,
    platform: post.platform,
    publishedAt: String(post.publishedAt ?? ""),
    title: String(post.title ?? ""),
    description: String(post.description ?? ""),
    permalink: post.permalink,
    imageUrl: null,
    thumbnailUrl: null,
    mediaType: post.mediaType ?? "UNKNOWN",
    ...(Number(post.mediaCount) > 1 ? { mediaCount: Number(post.mediaCount) } : {}),
    sourceName: String(post.sourceName ?? ""),
    localImage,
  };
}

async function fetchFeed(url) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, { headers: { Accept: "application/json" }, signal: controller.signal });
    if (!res.ok) throw new Error(`http_${res.status}`);
    const body = await res.json();
    if (!Array.isArray(body.posts)) throw new Error("invalid_response");
    return body;
  } finally {
    clearTimeout(timeoutId);
  }
}

async function main() {
  const existing = readExistingSnapshot();
  const feedUrl = process.env.SOCIAL_FEED_URL?.trim() || DEFAULT_FEED_URL;

  let posts;
  let fetchedAt;
  if (feedUrl === "off") {
    console.log("[sync-social-posts] SOCIAL_FEED_URL=off のため、前回のスナップショットを使います。");
    posts = existing.posts;
    fetchedAt = existing.fetchedAt;
  } else {
    try {
      const feed = await fetchFeed(feedUrl);
      posts = feed.posts;
      fetchedAt = feed.updatedAt ?? null;
      console.log(`[sync-social-posts] ${feedUrl} から ${posts.length}件を取得しました。`);
    } catch (err) {
      console.warn(
        `[sync-social-posts] 投稿一覧を取得できなかったため、前回のスナップショットを使います (${err instanceof Error ? err.message : "unknown_error"})`,
      );
      posts = existing.posts;
      fetchedAt = existing.fetchedAt;
    }
  }

  const sanitized = posts.map(sanitizePost).filter((p) => p !== null);
  sanitized.sort((a, b) => new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime());
  const signature = postsSignature(sanitized);
  const generatedAt = new Date().toISOString();

  mkdirSync(path.dirname(snapshotPath), { recursive: true });
  writeFileSync(snapshotPath, `${JSON.stringify({ generatedAt, fetchedAt, signature, posts: sanitized }, null, 2)}\n`, "utf8");

  mkdirSync(path.dirname(manifestPath), { recursive: true });
  writeFileSync(manifestPath, `${JSON.stringify({ generatedAt, signature, count: sanitized.length })}\n`, "utf8");

  const withImage = sanitized.filter((p) => p.localImage).length;
  console.log(`[sync-social-posts] スナップショット: ${sanitized.length}件（画像あり ${withImage}件） 署名=${signature}`);
}

await main();
