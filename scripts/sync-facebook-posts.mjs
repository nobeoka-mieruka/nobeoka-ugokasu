// ビルド前（predev/prebuild）に実行し、Facebookページの最新投稿を取得して
//   1. 投稿本文・日付・リンク等を src/data/socialPostsSnapshot.json へ書き出す
//      （トップページ・活動報告ページがビルド時のHTMLとして投稿カードを出力できるようにする）
//   2. 投稿の写真を public/images/social/facebook/{投稿ID}.webp としてローカル保存する
//      （Facebookの一時的なCDN画像URLを、ブラウザのimg要素へ直接ホットリンクしないため）
//
// 認証情報（FACEBOOK_PAGE_ID / META_ACCESS_TOKEN）が未設定の場合や、取得・変換に失敗した場合でも、
// ビルド全体を止めないことを最優先にする（警告ログを出し、空またはこれまでの結果のまま継続する）。
// アクセストークンや秘密情報は、ログにも出力ファイルにも一切含めない。

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = path.resolve(fileURLToPath(import.meta.url), "../..");
const imagesDir = path.join(rootDir, "public", "images", "social", "facebook");
const snapshotPath = path.join(rootDir, "src", "data", "socialPostsSnapshot.json");

const DEFAULT_API_VERSION = "v21.0";
const DEFAULT_LIMIT = 6;
const FETCH_TIMEOUT_MS = 10000;
const MAX_IMAGE_BYTES = 8 * 1024 * 1024; // 8MB
const MAX_IMAGE_WIDTH = 1200;
const TITLE_MAX_LENGTH = 40;

// ---- 1. ローカル開発用に .dev.vars / .env を（既存のprocess.envを上書きしない範囲で）読み込む ----
// Cloudflare Pagesのビルド環境では、これらの値はビルドプロセスの環境変数として直接注入される
// ため、この読み込みは主にローカルでの動作確認用（値が無くても何も起きない）。

function loadDotEnvFile(filePath) {
  if (!existsSync(filePath)) return;
  const content = readFileSync(filePath, "utf8");
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed.length === 0 || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim().replace(/^["']|["']$/g, "");
    if (key.length > 0 && process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}

loadDotEnvFile(path.join(rootDir, ".dev.vars"));
loadDotEnvFile(path.join(rootDir, ".env"));

// ---- 2. 設定値 ----

const pageId = process.env.FACEBOOK_PAGE_ID;
const accessToken = process.env.META_ACCESS_TOKEN;
const apiVersion = process.env.META_GRAPH_API_VERSION?.trim() || DEFAULT_API_VERSION;
const limit = (() => {
  const parsed = Number.parseInt(process.env.SOCIAL_POST_LIMIT ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_LIMIT;
})();

function writeSnapshot(posts) {
  mkdirSync(path.dirname(snapshotPath), { recursive: true });
  const snapshot = { generatedAt: new Date().toISOString(), posts };
  writeFileSync(snapshotPath, `${JSON.stringify(snapshot, null, 2)}\n`, "utf8");
  console.log(`[sync-facebook-posts] wrote ${snapshotPath} (${posts.length}件)`);
}

if (!pageId || !accessToken) {
  console.log(
    "[sync-facebook-posts] FACEBOOK_PAGE_ID または META_ACCESS_TOKEN が未設定のため、SNS自動取得をスキップします（サイトは手動投稿・空表示のまま正常にビルドされます）。",
  );
  writeSnapshot([]);
  process.exit(0);
}

// ---- 3. Facebookページ投稿の取得 ----

const FIELDS = "id,message,created_time,permalink_url,full_picture,attachments{media_type,type,url,media}";

async function fetchPublishedPosts() {
  const url =
    `https://graph.facebook.com/${apiVersion}/${encodeURIComponent(pageId)}/published_posts` +
    `?fields=${encodeURIComponent(FIELDS)}&limit=${limit}` +
    `&access_token=${encodeURIComponent(accessToken)}`;

  const res = await fetch(url);
  const body = await res.json();

  if (!res.ok || body.error) {
    const detail = {
      httpStatus: res.status,
      type: body.error?.type ?? null,
      code: body.error?.code ?? null,
      // アクセストークンがエラーメッセージに含まれるケースがあるため出力しない
    };
    throw new Error(`facebook_api_error:${JSON.stringify(detail)}`);
  }

  return Array.isArray(body.data) ? body.data : [];
}

// ---- 4. 投稿の正規化（server/normalize.ts の normalizeFacebookPost と同じ優先順位） ----

const CONTROL_CHAR_MAX_CODE = 0x1f;

function sanitizeText(text) {
  let result = "";
  for (const ch of text) {
    const code = ch.codePointAt(0) ?? 0;
    const isUnwantedControl = code <= CONTROL_CHAR_MAX_CODE && ch !== "\n" && ch !== "\t";
    if (!isUnwantedControl) result += ch;
  }
  return result.trim();
}

function makeTitle(body, fallback) {
  const clean = sanitizeText(body);
  if (clean.length === 0) return fallback;
  const firstLine = clean.split(/\r?\n/)[0];
  if (firstLine.length <= TITLE_MAX_LENGTH) return firstLine;
  return `${firstLine.slice(0, TITLE_MAX_LENGTH)}...`;
}

function normalizeFacebookPost(raw) {
  if (!raw.id || !raw.permalink_url) return null;

  const message = sanitizeText(raw.message ?? "");
  const attachment = raw.attachments?.data?.[0];

  let mediaType = "STATUS";
  let imageUrl = null;
  let thumbnailUrl = null;

  if (attachment?.media_type === "video") {
    mediaType = "VIDEO";
    thumbnailUrl = attachment.media?.image?.src ?? raw.full_picture ?? null;
  } else if (attachment?.media_type === "album") {
    mediaType = "CAROUSEL_ALBUM";
    imageUrl = raw.full_picture ?? attachment.media?.image?.src ?? null;
  } else if (attachment?.media_type === "photo" || raw.full_picture) {
    mediaType = "IMAGE";
    imageUrl = raw.full_picture ?? attachment?.media?.image?.src ?? null;
  } else if (attachment?.url) {
    mediaType = "LINK";
    imageUrl = attachment.media?.image?.src ?? null;
  }

  return {
    id: raw.id,
    platform: "facebook",
    publishedAt: raw.created_time ?? new Date().toISOString(),
    title: makeTitle(message, "Facebook活動報告"),
    description: message,
    permalink: raw.permalink_url,
    imageUrl,
    thumbnailUrl,
    mediaType,
    sourceName: "Facebook",
    localImage: null,
  };
}

// ---- 5. 画像のダウンロード・ローカル保存 ----

const ALLOWED_HOSTNAME_SUFFIXES = [".fbcdn.net", ".fbsbx.com"];
const ALLOWED_EXACT_HOSTNAMES = ["fbcdn.net", "graph.facebook.com"];

function isAllowedImageHost(rawUrl) {
  let parsed;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return false;
  }
  if (parsed.protocol !== "https:") return false;
  const hostname = parsed.hostname.toLowerCase();
  if (ALLOWED_EXACT_HOSTNAMES.includes(hostname)) return true;
  return ALLOWED_HOSTNAME_SUFFIXES.some((suffix) => hostname.endsWith(suffix));
}

function safeFileNameForPostId(postId) {
  return postId.replace(/[^a-zA-Z0-9_-]/g, "_");
}

async function downloadImageBytes(rawUrl) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(rawUrl, { redirect: "follow", signal: controller.signal });
    if (!res.ok) throw new Error(`image_fetch_status_${res.status}`);

    const contentType = res.headers.get("content-type") ?? "";
    if (!contentType.toLowerCase().startsWith("image/")) throw new Error("not_an_image");

    const contentLength = res.headers.get("content-length");
    if (contentLength && Number(contentLength) > MAX_IMAGE_BYTES) throw new Error("image_too_large");

    const buffer = Buffer.from(await res.arrayBuffer());
    if (buffer.byteLength > MAX_IMAGE_BYTES) throw new Error("image_too_large");
    return buffer;
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * 投稿1件分の画像を取得・変換してローカル保存する。既に同名ファイルがあれば再ダウンロードせず、
 * そのファイルの寸法だけを読み直して返す（同じ画像を毎回重複保存しない）。
 * 失敗しても例外を投げず、警告ログを出してnullを返す（呼び出し側はlocalImage無しとして続行）。
 */
async function mirrorPostImage(sharpModule, post, candidateUrl) {
  if (!candidateUrl) return null;
  if (!isAllowedImageHost(candidateUrl)) {
    console.warn(`[sync-facebook-posts] 許可されていない画像ホストのためスキップ: post=${post.id}`);
    return null;
  }

  const fileName = `${safeFileNameForPostId(post.id)}.webp`;
  const filePath = path.join(imagesDir, fileName);
  const publicSrc = `/images/social/facebook/${fileName}`;

  if (existsSync(filePath)) {
    try {
      const metadata = await sharpModule(filePath).metadata();
      return { src: publicSrc, width: metadata.width ?? 0, height: metadata.height ?? 0 };
    } catch (err) {
      console.warn(
        `[sync-facebook-posts] 既存ファイルの読み込みに失敗したため再取得します: post=${post.id} (${err instanceof Error ? err.message : "unknown_error"})`,
      );
    }
  }

  try {
    const original = await downloadImageBytes(candidateUrl);
    const pipeline = sharpModule(original).rotate().resize({ width: MAX_IMAGE_WIDTH, withoutEnlargement: true }).webp({ quality: 82 });
    const { data, info } = await pipeline.toBuffer({ resolveWithObject: true });
    mkdirSync(imagesDir, { recursive: true });
    writeFileSync(filePath, data);
    return { src: publicSrc, width: info.width, height: info.height };
  } catch (err) {
    console.warn(
      `[sync-facebook-posts] 画像の取得・変換に失敗したためスキップします: post=${post.id} (${err instanceof Error ? err.message : "unknown_error"})`,
    );
    return null;
  }
}

// ---- 6. 実行 ----

async function main() {
  let rawPosts;
  try {
    rawPosts = await fetchPublishedPosts();
  } catch (err) {
    console.warn(
      `[sync-facebook-posts] Facebook投稿の取得に失敗しました。既存のスナップショットは変更しません (${err instanceof Error ? err.message : "unknown_error"})`,
    );
    // 直前のスナップショットが無ければ空で書き出す（ビルドは止めない）
    if (!existsSync(snapshotPath)) writeSnapshot([]);
    process.exit(0);
  }

  const normalized = rawPosts.map(normalizeFacebookPost).filter((p) => p !== null);

  // sharpはastro（画像最適化）が依存として利用可能な環境であれば動作する。
  // 万一読み込めない環境でも、画像ミラーだけをスキップしてビルドは継続する。
  let sharpModule = null;
  try {
    ({ default: sharpModule } = await import("sharp"));
  } catch (err) {
    console.warn(
      `[sync-facebook-posts] sharpの読み込みに失敗したため、画像のローカル保存をスキップします (${err instanceof Error ? err.message : "unknown_error"})`,
    );
  }

  const posts = [];
  for (const post of normalized) {
    let localImage = null;
    if (sharpModule) {
      const candidateUrl = post.imageUrl ?? post.thumbnailUrl;
      localImage = await mirrorPostImage(sharpModule, post, candidateUrl);
    }
    posts.push({ ...post, localImage });
  }

  posts.sort((a, b) => new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime());

  writeSnapshot(posts);
  const mirroredCount = posts.filter((p) => p.localImage).length;
  console.log(`[sync-facebook-posts] 画像ローカル保存: ${mirroredCount}/${posts.length}件`);
}

await main();
