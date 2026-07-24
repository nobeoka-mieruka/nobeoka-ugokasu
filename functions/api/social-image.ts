// GET /api/social-image?u=<エンコード済みのFacebook CDN画像URL>
//
// Facebookの一時的なCDN画像URLを、ブラウザのimg要素へ直接設定（ホットリンク）しないための
// 同一オリジン経由プロキシです。ビルド時同期（scripts/sync-facebook-posts.mjs）でローカル
// ミラー保存できなかった画像（ビルド後に新規投稿された分）のみ、このプロキシ経由で表示します。
//
// 安全のため、次をすべて満たさない限り画像を返しません。
//   - 許可されたFacebook画像配信ドメインのみ（任意URLを取得できる汎用プロキシにしない）
//   - https のみ
//   - 応答のContent-Typeが image/* であること
//   - 取得サイズが上限以下であること（メモリ枯渇・DoS対策）
//   - 取得タイムアウトあり
// 取得結果はCloudflareのCache APIでエッジキャッシュし、Facebook側への再取得を抑える。
// アクセストークン等の秘密情報はこのエンドポイントでは一切使用・送信しない。

const ALLOWED_HOSTNAME_SUFFIXES = [".fbcdn.net", ".fbsbx.com"];
const ALLOWED_EXACT_HOSTNAMES = ["fbcdn.net", "graph.facebook.com"];

const FETCH_TIMEOUT_MS = 8000;
const MAX_BYTES = 8 * 1024 * 1024; // 8MB
const CACHE_CONTROL = "public, max-age=86400, s-maxage=604800, stale-while-revalidate=2592000";

function isAllowedHostname(hostname: string): boolean {
  const lower = hostname.toLowerCase();
  if (ALLOWED_EXACT_HOSTNAMES.includes(lower)) return true;
  return ALLOWED_HOSTNAME_SUFFIXES.some((suffix) => lower.endsWith(suffix));
}

function parseAllowedImageUrl(raw: string | null): URL | null {
  if (!raw) return null;
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return null;
  }
  if (parsed.protocol !== "https:") return null;
  if (!isAllowedHostname(parsed.hostname)) return null;
  return parsed;
}

function jsonError(status: number, error: string): Response {
  return new Response(JSON.stringify({ ok: false, error }), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}

async function readWithSizeLimit(response: Response, limitBytes: number): Promise<Uint8Array> {
  const reader = response.body?.getReader();
  if (!reader) return new Uint8Array(await response.arrayBuffer());

  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    total += value.byteLength;
    if (total > limitBytes) {
      await reader.cancel();
      throw new Error("image_too_large");
    }
    chunks.push(value);
  }

  const combined = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    combined.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return combined;
}

async function fetchUpstreamImage(url: URL): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const upstream = await fetch(url.toString(), {
      redirect: "follow",
      signal: controller.signal,
      headers: { Accept: "image/*" },
    });

    if (!upstream.ok) {
      throw new Error(`upstream_status_${upstream.status}`);
    }

    const contentType = upstream.headers.get("content-type") ?? "";
    if (!contentType.toLowerCase().startsWith("image/")) {
      throw new Error("not_an_image");
    }

    const contentLengthHeader = upstream.headers.get("content-length");
    if (contentLengthHeader && Number(contentLengthHeader) > MAX_BYTES) {
      throw new Error("image_too_large");
    }

    const bytes = await readWithSizeLimit(upstream, MAX_BYTES);

    return new Response(bytes, {
      status: 200,
      headers: {
        "Content-Type": contentType,
        "Cache-Control": CACHE_CONTROL,
      },
    });
  } finally {
    clearTimeout(timeoutId);
  }
}

async function handleGet(context: Parameters<PagesFunction>[0]): Promise<Response> {
  const requestUrl = new URL(context.request.url);
  const target = parseAllowedImageUrl(requestUrl.searchParams.get("u"));

  if (!target) {
    return jsonError(400, "invalid_or_disallowed_url");
  }

  // CloudflareエッジのCache APIで結果をキャッシュし、同じ画像への再アクセスでFacebook側へ
  // 問い合わせないようにする（キャッシュキーはこのリクエストURL自体＝uパラメータ込み）。
  const cache = caches.default;
  const cacheKey = new Request(context.request.url, { method: "GET" });
  const cached = await cache.match(cacheKey);
  if (cached) return cached;

  try {
    const response = await fetchUpstreamImage(target);
    context.waitUntil(cache.put(cacheKey, response.clone()));
    return response;
  } catch (err) {
    // 秘密情報は関与しないため、原因の分類だけログへ残す
    // eslint-disable-next-line no-console
    console.warn("social-image: fetch failed", err instanceof Error ? err.message : "unknown_error");
    return jsonError(502, "upstream_fetch_failed");
  }
}

export const onRequestGet: PagesFunction = async (context) => handleGet(context);

export const onRequest: PagesFunction = async (context) => {
  if (context.request.method !== "GET") {
    return new Response(JSON.stringify({ ok: false, error: "method_not_allowed" }), {
      status: 405,
      headers: { "Content-Type": "application/json; charset=utf-8", Allow: "GET" },
    });
  }
  return handleGet(context);
};
