// ビルド前（predev/prebuild）に実行し、Facebook・Threadsの最新投稿を取得して
//   1. 投稿本文・日付・リンク等を src/data/socialPostsSnapshot.json へ書き出す
//      （トップページ・活動報告ページがビルド時のHTMLとして投稿カードを出力できるようにする）
//   2. 投稿の写真を public/images/social/{facebook|threads}/{投稿ID}.webp としてローカル保存する
//      （SNS側の一時的なCDN画像URLを、ブラウザのimg要素へ直接ホットリンクしないため）
//
// Instagramはビルド時スナップショットの対象外です（プロアカウント接続の都合上、実行時API
// /api/social-feed からのみ取得します。functions/api/social-feed.ts・server/socialSync.ts参照）。
//
// 認証情報（FACEBOOK_PAGE_ID/META_ACCESS_TOKEN、THREADS_USER_ID/THREADS_ACCESS_TOKEN）が
// プラットフォームごとに未設定の場合や、取得・変換に失敗した場合でも、ビルド全体を止めない
// ことを最優先にする（警告ログを出し、そのプラットフォームだけ0件・これまでの結果のまま継続する）。
// アクセストークンや秘密情報は、ログにも出力ファイルにも一切含めない。

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = path.resolve(fileURLToPath(import.meta.url), "../..");
const snapshotPath = path.join(rootDir, "src", "data", "socialPostsSnapshot.json");

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

function writeSnapshot(posts) {
  mkdirSync(path.dirname(snapshotPath), { recursive: true });
  const snapshot = { generatedAt: new Date().toISOString(), posts };
  writeFileSync(snapshotPath, `${JSON.stringify(snapshot, null, 2)}\n`, "utf8");
  console.log(`[sync-social-posts] wrote ${snapshotPath} (${posts.length}件)`);
}

// ---- 投稿本文からのタイトル生成（server/normalize.ts と同じ優先順位） ----

const CONTROL_CHAR_MAX_CODE = 0x1f;
// 1行がハッシュタグ（と空白）だけで構成されているかの判定用
const HASHTAG_ONLY_LINE = /^(#\S+)(\s+#\S+)*$/u;
const HASHTAG_PATTERN = /#[^\s#]+/gu;

function sanitizeText(text) {
  let result = "";
  for (const ch of text) {
    const code = ch.codePointAt(0) ?? 0;
    const isUnwantedControl = code <= CONTROL_CHAR_MAX_CODE && ch !== "\n" && ch !== "\t";
    if (!isUnwantedControl) result += ch;
  }
  return result.trim();
}

function isHashtagOnlyLine(line) {
  return HASHTAG_ONLY_LINE.test(line);
}

// ハッシュタグしか無い行から、タイトルとして表示できる文言を作る。
// ハッシュタグの文字列そのものを使うだけで、投稿内容にない事実は補わない。
function titleFromHashtags(line) {
  const tags = (line.match(HASHTAG_PATTERN) ?? []).map((tag) => tag.slice(1)).filter(Boolean);
  if (tags.length === 0) return null;
  const joined = tags.slice(0, 2).join("・");
  const title = `${joined}について`;
  return title.length <= TITLE_MAX_LENGTH ? title : `${joined.slice(0, TITLE_MAX_LENGTH - 1)}…`;
}

// 投稿本文からタイトルを作る。先頭行がハッシュタグだけの場合（例：
// 「#就労継続支援B型事業所延岡」）は、本文中に文章がある行があればそちらを優先し、
// 投稿全体がハッシュタグだけの場合はハッシュタグの文言から読める形のタイトルを作る。
function makeTitle(body, fallback) {
  const clean = sanitizeText(body);
  if (clean.length === 0) return fallback;

  const lines = clean
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  if (lines.length === 0) return fallback;

  const sourceLine = lines.find((line) => !isHashtagOnlyLine(line)) ?? lines[0];

  if (isHashtagOnlyLine(sourceLine)) {
    return titleFromHashtags(sourceLine) ?? fallback;
  }

  if (sourceLine.length <= TITLE_MAX_LENGTH) return sourceLine;
  return `${sourceLine.slice(0, TITLE_MAX_LENGTH)}...`;
}

// ---- 画像のダウンロード・ローカル保存（プラットフォーム共通） ----

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
 *
 * platform: "facebook" | "threads"（保存先ディレクトリ・許可ホスト一覧の切り替えに使う）
 */
async function mirrorPostImage(sharpModule, platform, isAllowedImageHost, post, candidateUrl) {
  if (!candidateUrl) return null;
  if (!isAllowedImageHost(candidateUrl)) {
    console.warn(`[sync-social-posts] 許可されていない画像ホストのためスキップ: platform=${platform} post=${post.id}`);
    return null;
  }

  const imagesDir = path.join(rootDir, "public", "images", "social", platform);
  const fileName = `${safeFileNameForPostId(post.id)}.webp`;
  const filePath = path.join(imagesDir, fileName);
  const publicSrc = `/images/social/${platform}/${fileName}`;

  if (existsSync(filePath)) {
    try {
      const metadata = await sharpModule(filePath).metadata();
      return { src: publicSrc, width: metadata.width ?? 0, height: metadata.height ?? 0 };
    } catch (err) {
      console.warn(
        `[sync-social-posts] 既存ファイルの読み込みに失敗したため再取得します: platform=${platform} post=${post.id} (${err instanceof Error ? err.message : "unknown_error"})`,
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
      `[sync-social-posts] 画像の取得・変換に失敗したためスキップします: platform=${platform} post=${post.id} (${err instanceof Error ? err.message : "unknown_error"})`,
    );
    return null;
  }
}

async function mirrorPosts(sharpModule, platform, isAllowedImageHost, normalizedPosts) {
  if (!sharpModule) return normalizedPosts.map((post) => ({ ...post, localImage: null }));

  const posts = [];
  for (const post of normalizedPosts) {
    const candidateUrl = post.imageUrl ?? post.thumbnailUrl;
    const localImage = await mirrorPostImage(sharpModule, platform, isAllowedImageHost, post, candidateUrl);
    posts.push({ ...post, localImage });
  }
  return posts;
}

// ---- 2. Facebookページ投稿の取得・正規化 ----

const FACEBOOK_DEFAULT_API_VERSION = "v21.0";
const FACEBOOK_FIELDS = "id,message,created_time,permalink_url,full_picture,attachments{media_type,type,url,media}";
const FACEBOOK_ALLOWED_HOSTNAME_SUFFIXES = [".fbcdn.net", ".fbsbx.com"];
const FACEBOOK_ALLOWED_EXACT_HOSTNAMES = ["fbcdn.net", "graph.facebook.com"];

function isAllowedFacebookImageHost(rawUrl) {
  return isAllowedImageHostGeneric(rawUrl, FACEBOOK_ALLOWED_EXACT_HOSTNAMES, FACEBOOK_ALLOWED_HOSTNAME_SUFFIXES);
}

function isAllowedImageHostGeneric(rawUrl, exactHostnames, suffixes) {
  let parsed;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return false;
  }
  if (parsed.protocol !== "https:") return false;
  const hostname = parsed.hostname.toLowerCase();
  if (exactHostnames.includes(hostname)) return true;
  return suffixes.some((suffix) => hostname.endsWith(suffix));
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
  };
}

async function fetchFacebookNormalizedPosts(limit) {
  const pageId = process.env.FACEBOOK_PAGE_ID;
  const accessToken = process.env.META_ACCESS_TOKEN;
  const apiVersion = process.env.META_GRAPH_API_VERSION?.trim() || FACEBOOK_DEFAULT_API_VERSION;

  if (!pageId || !accessToken) {
    console.log(
      "[sync-social-posts] FACEBOOK_PAGE_ID または META_ACCESS_TOKEN が未設定のため、Facebook自動取得をスキップします。",
    );
    return NOT_CONFIGURED;
  }

  const url =
    `https://graph.facebook.com/${apiVersion}/${encodeURIComponent(pageId)}/published_posts` +
    `?fields=${encodeURIComponent(FACEBOOK_FIELDS)}&limit=${limit}` +
    `&access_token=${encodeURIComponent(accessToken)}`;

  let body;
  try {
    const res = await fetch(url);
    body = await res.json();
    if (!res.ok || body.error) {
      const detail = {
        httpStatus: res.status,
        type: body.error?.type ?? null,
        code: body.error?.code ?? null,
        // アクセストークンがエラーメッセージに含まれるケースがあるため出力しない
      };
      throw new Error(`facebook_api_error:${JSON.stringify(detail)}`);
    }
  } catch (err) {
    console.warn(
      `[sync-social-posts] Facebook投稿の取得に失敗しました (${err instanceof Error ? err.message : "unknown_error"})`,
    );
    return null; // 取得失敗（未設定とは区別。呼び出し側で既存スナップショットのFacebook分を維持する）
  }

  const rawPosts = Array.isArray(body.data) ? body.data : [];
  return rawPosts.map(normalizeFacebookPost).filter((p) => p !== null);
}

// ---- 3. Threads投稿の取得・正規化（公式Threads API: graph.threads.net） ----

const THREADS_DEFAULT_API_VERSION = "v1.0";
const THREADS_FIELDS = "id,media_type,text,permalink,timestamp,media_url,thumbnail_url,children{media_type,media_url}";
// Threadsの投稿画像はMeta（Instagram/Threads共通）のCDNから配信される。
const THREADS_ALLOWED_HOSTNAME_SUFFIXES = [".cdninstagram.com", ".fbcdn.net"];
const THREADS_ALLOWED_EXACT_HOSTNAMES = [];

function isAllowedThreadsImageHost(rawUrl) {
  return isAllowedImageHostGeneric(rawUrl, THREADS_ALLOWED_EXACT_HOSTNAMES, THREADS_ALLOWED_HOSTNAME_SUFFIXES);
}

function normalizeThreadsPost(raw) {
  if (!raw.id || !raw.permalink) return null;

  const text = sanitizeText(raw.text ?? "");
  const rawType = (raw.media_type ?? "TEXT_POST").toUpperCase();

  let mediaType = "STATUS";
  let imageUrl = null;
  let thumbnailUrl = null;

  if (rawType === "CAROUSEL_ALBUM") {
    mediaType = "CAROUSEL_ALBUM";
    const firstChild = raw.children?.data?.[0];
    const childIsVideo = (firstChild?.media_type ?? "").toUpperCase() === "VIDEO";
    if (childIsVideo) {
      thumbnailUrl = firstChild?.media_url ?? null;
    } else {
      imageUrl = firstChild?.media_url ?? null;
    }
  } else if (rawType === "VIDEO") {
    mediaType = "VIDEO";
    thumbnailUrl = raw.thumbnail_url ?? raw.media_url ?? null;
  } else if (rawType === "IMAGE") {
    mediaType = "IMAGE";
    imageUrl = raw.media_url ?? null;
  }
  // "TEXT_POST" | "AUDIO" | "REPOST_FACADE" 等、画像を持たない投稿種別は mediaType: "STATUS" のまま

  return {
    id: raw.id,
    platform: "threads",
    publishedAt: raw.timestamp ?? new Date().toISOString(),
    title: makeTitle(text, "Threads活動報告"),
    description: text,
    permalink: raw.permalink,
    imageUrl,
    thumbnailUrl,
    mediaType,
    sourceName: "Threads",
  };
}

async function fetchThreadsNormalizedPosts(limit) {
  const userId = process.env.THREADS_USER_ID;
  const accessToken = process.env.THREADS_ACCESS_TOKEN;
  const apiVersion = THREADS_DEFAULT_API_VERSION;

  if (!userId || !accessToken) {
    console.log(
      "[sync-social-posts] THREADS_USER_ID または THREADS_ACCESS_TOKEN が未設定のため、Threads自動取得をスキップします。",
    );
    return NOT_CONFIGURED;
  }

  const url =
    `https://graph.threads.net/${apiVersion}/${encodeURIComponent(userId)}/threads` +
    `?fields=${encodeURIComponent(THREADS_FIELDS)}&limit=${limit}` +
    `&access_token=${encodeURIComponent(accessToken)}`;

  let body;
  try {
    const res = await fetch(url);
    body = await res.json();
    if (!res.ok || body.error) {
      const detail = {
        httpStatus: res.status,
        type: body.error?.type ?? null,
        code: body.error?.code ?? null,
        // アクセストークンがエラーメッセージに含まれるケースがあるため出力しない
      };
      throw new Error(`threads_api_error:${JSON.stringify(detail)}`);
    }
  } catch (err) {
    console.warn(
      `[sync-social-posts] Threads投稿の取得に失敗しました (${err instanceof Error ? err.message : "unknown_error"})`,
    );
    return null; // 取得失敗（未設定とは区別。呼び出し側で既存スナップショットのThreads分を維持する）
  }

  const rawPosts = Array.isArray(body.data) ? body.data : [];
  return rawPosts.map(normalizeThreadsPost).filter((p) => p !== null);
}

// ---- 4. 実行 ----

/**
 * 「認証情報が未設定のためAPIを呼ばなかった」ことを表す値。
 * 「取得に成功したが0件だった」（＝空配列）とは明確に区別する。
 * 未設定・取得失敗のどちらの場合も、直前のスナップショットに入っていた投稿を
 * そのまま引き継ぎ、ビルドのたびに活動報告が消えてしまうことを防ぐ（15章）。
 */
const NOT_CONFIGURED = Symbol("not_configured");

const DEFAULT_LIMIT = 6;
const limit = (() => {
  const parsed = Number.parseInt(process.env.SOCIAL_POST_LIMIT ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_LIMIT;
})();

function readExistingSnapshotPosts() {
  if (!existsSync(snapshotPath)) return [];
  try {
    const parsed = JSON.parse(readFileSync(snapshotPath, "utf8"));
    return Array.isArray(parsed.posts) ? parsed.posts : [];
  } catch {
    return [];
  }
}

async function main() {
  // sharpはastro（画像最適化）が依存として利用可能な環境であれば動作する。
  // 万一読み込めない環境でも、画像ミラーだけをスキップしてビルドは継続する。
  let sharpModule = null;
  try {
    ({ default: sharpModule } = await import("sharp"));
  } catch (err) {
    console.warn(
      `[sync-social-posts] sharpの読み込みに失敗したため、画像のローカル保存をスキップします (${err instanceof Error ? err.message : "unknown_error"})`,
    );
  }

  const existingPosts = readExistingSnapshotPosts();

  // fetchXNormalizedPosts()の戻り値:
  //   配列            ＝ 取得成功（0件の場合も含む）
  //   null            ＝ 取得を試みたが失敗した
  //   NOT_CONFIGURED  ＝ 認証情報が未設定でAPIを呼ばなかった
  //
  // 失敗・未設定のどちらの場合も、直前のスナップショットにあった当該プラットフォーム分
  //（localImage込み）をそのまま引き継ぐ。こうしないと、トークンの期限切れや環境変数の
  // 設定漏れがあっただけで、これまで表示できていた活動報告がビルドのたびに消えてしまう
  //（15章：取得失敗時に画面が空になる設計にしない）。
  async function resolvePlatformPosts(platform, isAllowedHost, fetchResult) {
    if (fetchResult === null || fetchResult === NOT_CONFIGURED) {
      const kept = existingPosts.filter((p) => p.platform === platform);
      if (kept.length > 0) {
        console.log(
          `[sync-social-posts] ${platform}: 最新の取得ができなかったため、前回のスナップショット${kept.length}件をそのまま引き継ぎます。`,
        );
      }
      return kept;
    }
    return mirrorPosts(sharpModule, platform, isAllowedHost, fetchResult);
  }

  const [facebookResult, threadsResult] = await Promise.all([
    fetchFacebookNormalizedPosts(limit),
    fetchThreadsNormalizedPosts(limit),
  ]);

  const facebookPosts = await resolvePlatformPosts("facebook", isAllowedFacebookImageHost, facebookResult);
  const threadsPosts = await resolvePlatformPosts("threads", isAllowedThreadsImageHost, threadsResult);

  const posts = [...facebookPosts, ...threadsPosts];
  posts.sort((a, b) => new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime());

  writeSnapshot(posts);
  const mirroredCount = posts.filter((p) => p.localImage).length;
  console.log(
    `[sync-social-posts] Facebook: ${facebookPosts.length}件 / Threads: ${threadsPosts.length}件 / 画像ローカル保存: ${mirroredCount}/${posts.length}件`,
  );
}

await main();
