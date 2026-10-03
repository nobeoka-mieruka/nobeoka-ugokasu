// SNS投稿の画像を、同期のタイミングで取得してCloudflare KVへ保存（ミラー）する処理です。
//
// なぜ必要か：
//   Facebook・Instagram・ThreadsのAPIが返す画像URL（*.fbcdn.net / *.cdninstagram.com）は
//   「oe=」パラメータ付きの署名付きURLで、数日〜数週間で無効（403）になります。
//   このURLを保存・表示し続けると、時間が経つと画像が壊れて表示されます。
//   そこで、取得できた時点で画像そのものをKVへ保存し、自社ドメインの
//   /api/social-image?k=... から配信します（functions/api/social-image.ts）。
//
// 方針：
//   - 公式APIが返した画像URLだけを取得する（スクレイピングはしない）
//   - 許可したMetaの画像配信ドメイン・https・image/*・サイズ上限・タイムアウトを必ず検証する
//   - 同じ投稿・同じ画像は再ダウンロードしない（画像URLのパス部分が変わらない限り再利用）
//   - 画像の保存キーには投稿IDと画像パスのハッシュを含め、画像が差し替わったらURLも変わる
//   - 1件の画像取得に失敗しても例外を投げず、その投稿だけ「画像なし」として扱う
//   - アクセストークン等の秘密情報は一切使わない・保存しない

import type { SocialPost } from "../src/types/social";
import type { SocialSyncEnv } from "./env";

const ALLOWED_HOSTNAME_SUFFIXES = [".fbcdn.net", ".fbsbx.com", ".cdninstagram.com"];
const ALLOWED_EXACT_HOSTNAMES = ["fbcdn.net"];
const ALLOWED_CONTENT_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"];

const FETCH_TIMEOUT_MS = 8000;
const MAX_IMAGE_BYTES = 5 * 1024 * 1024; // 5MB
/** 1回の同期で新たにダウンロードする画像の上限（Workersのサブリクエスト数の上限対策）。残りは次回の同期で取得する */
const MAX_DOWNLOADS_PER_RUN = 12;

const IMAGE_KEY_PREFIX = "social-image:v1:";
/** 公開URLの k パラメータの形式（platform_投稿ID_ハッシュ8桁） */
export const IMAGE_ID_PATTERN = /^(facebook|instagram|threads)_[A-Za-z0-9_-]{1,100}_[0-9a-f]{8}$/;

export function imageKvKey(imageId: string): string {
  return `${IMAGE_KEY_PREFIX}${imageId}`;
}

export function imagePublicSrc(imageId: string): string {
  return `/api/social-image?k=${imageId}`;
}

/** 文字列から8桁の16進ハッシュを作る（FNV-1a。キャッシュバスティング用で暗号強度は不要） */
function hash8(text: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function parseAllowedImageUrl(raw: string | null | undefined): URL | null {
  if (!raw) return null;
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return null;
  }
  if (parsed.protocol !== "https:") return null;
  const host = parsed.hostname.toLowerCase();
  const allowed = ALLOWED_EXACT_HOSTNAMES.includes(host) || ALLOWED_HOSTNAME_SUFFIXES.some((s) => host.endsWith(s));
  return allowed ? parsed : null;
}

/** 画像の取得元を識別する値。署名・有効期限を含むクエリ文字列は除き、ホスト＋パスだけを使う */
function imageSourceOf(url: URL): string {
  return `${url.hostname}${url.pathname}`;
}

/** JPEG / PNG / WebP / GIF のヘッダーから画像の幅・高さを読み取る（読めない場合は0） */
export function readImageSize(bytes: Uint8Array): { width: number; height: number } {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const len = bytes.byteLength;
  // PNG
  if (len >= 24 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
    return { width: view.getUint32(16), height: view.getUint32(20) };
  }
  // GIF
  if (len >= 10 && bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46) {
    return { width: view.getUint16(6, true), height: view.getUint16(8, true) };
  }
  // WebP（RIFF....WEBP）
  if (len >= 30 && bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[8] === 0x57 && bytes[9] === 0x45) {
    const chunk = String.fromCharCode(bytes[12], bytes[13], bytes[14], bytes[15]);
    if (chunk === "VP8X") {
      const w = 1 + (bytes[24] | (bytes[25] << 8) | (bytes[26] << 16));
      const h = 1 + (bytes[27] | (bytes[28] << 8) | (bytes[29] << 16));
      return { width: w, height: h };
    }
    if (chunk === "VP8 ") {
      return { width: view.getUint16(26, true) & 0x3fff, height: view.getUint16(28, true) & 0x3fff };
    }
    if (chunk === "VP8L") {
      const b = view.getUint32(21, true);
      return { width: (b & 0x3fff) + 1, height: ((b >> 14) & 0x3fff) + 1 };
    }
  }
  // JPEG：SOFマーカーを探す
  if (len >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8) {
    let offset = 2;
    while (offset + 9 < len) {
      if (bytes[offset] !== 0xff) {
        offset++;
        continue;
      }
      const marker = bytes[offset + 1];
      const isSof = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
      if (isSof) {
        return { height: view.getUint16(offset + 5), width: view.getUint16(offset + 7) };
      }
      const segmentLength = view.getUint16(offset + 2);
      if (segmentLength < 2) break;
      offset += 2 + segmentLength;
    }
  }
  return { width: 0, height: 0 };
}

async function downloadImage(url: URL): Promise<{ bytes: Uint8Array; contentType: string }> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url.toString(), { redirect: "follow", signal: controller.signal, headers: { Accept: "image/*" } });
    if (!res.ok) throw new Error(`image_status_${res.status}`);
    const contentType = (res.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
    if (!ALLOWED_CONTENT_TYPES.includes(contentType)) throw new Error("not_an_image");
    const declared = Number(res.headers.get("content-length") ?? "0");
    if (declared > MAX_IMAGE_BYTES) throw new Error("image_too_large");
    const bytes = new Uint8Array(await res.arrayBuffer());
    if (bytes.byteLength === 0) throw new Error("image_empty");
    if (bytes.byteLength > MAX_IMAGE_BYTES) throw new Error("image_too_large");
    return { bytes, contentType };
  } finally {
    clearTimeout(timeoutId);
  }
}

export interface MirrorResult {
  posts: SocialPost[];
  downloaded: number;
  reused: number;
  failed: number;
  /** 上限に達したため今回は取得を見送った件数（次回の同期で取得する） */
  deferred: number;
}

/**
 * 投稿一覧の画像をKVへ保存し、localImage を設定した投稿一覧を返す。
 * previousPosts（直前のキャッシュ）に同じ投稿・同じ画像の保存結果があれば再利用する。
 * 戻り値の投稿は imageUrl / thumbnailUrl を必ずnullにする（期限付きURLを残さない）。
 */
export async function mirrorPostImages(
  env: SocialSyncEnv,
  posts: SocialPost[],
  previousPosts: SocialPost[],
): Promise<MirrorResult> {
  const previousByKey = new Map(previousPosts.map((p) => [`${p.platform}:${p.id}`, p]));
  const result: MirrorResult = { posts: [], downloaded: 0, reused: 0, failed: 0, deferred: 0 };

  for (const post of posts) {
    const previous = previousByKey.get(`${post.platform}:${post.id}`);
    const sourceUrl = parseAllowedImageUrl(post.imageUrl ?? post.thumbnailUrl);
    const base: SocialPost = { ...post, imageUrl: null, thumbnailUrl: null };

    // SNS側の画像URLが無い（または許可外）場合：直前に保存済みの画像があればそれを使い続ける
    // （他のプラットフォームから引き継いだ投稿など、元URLを持たない投稿もここに来る）
    if (!sourceUrl) {
      result.posts.push({ ...base, localImage: post.localImage ?? previous?.localImage ?? null, imageSource: post.imageSource ?? previous?.imageSource ?? null });
      continue;
    }

    const source = imageSourceOf(sourceUrl);
    if (previous?.localImage && previous.imageSource === source) {
      result.reused++;
      result.posts.push({ ...base, localImage: previous.localImage, imageSource: source });
      continue;
    }

    if (result.downloaded + result.failed >= MAX_DOWNLOADS_PER_RUN) {
      result.deferred++;
      result.posts.push({ ...base, localImage: previous?.localImage ?? null, imageSource: previous?.imageSource ?? null });
      continue;
    }

    const safeId = post.id.replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 100);
    const imageId = `${post.platform}_${safeId}_${hash8(source)}`;

    try {
      const { bytes, contentType } = await downloadImage(sourceUrl);
      const { width, height } = readImageSize(bytes);
      await env.SOCIAL_POSTS_KV.put(imageKvKey(imageId), bytes, {
        metadata: { contentType, width, height, postId: post.id, platform: post.platform },
      });
      result.downloaded++;
      result.posts.push({ ...base, localImage: { src: imagePublicSrc(imageId), width, height }, imageSource: source });
    } catch (err) {
      result.failed++;
      // eslint-disable-next-line no-console
      console.warn(
        JSON.stringify({
          event: "social-image-mirror-failed",
          platform: post.platform,
          postId: post.id,
          reason: err instanceof Error ? err.message : "unknown_error",
        }),
      );
      // 取得できなかった場合は、以前保存できていた画像があればそれを使い、無ければ画像なし
      result.posts.push({ ...base, localImage: previous?.localImage ?? null, imageSource: previous?.imageSource ?? null });
    }
  }

  return result;
}
