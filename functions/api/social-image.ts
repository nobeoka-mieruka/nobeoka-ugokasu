// GET /api/social-image?k=<画像ID>
//
// SNS投稿の画像を、自社ドメインから配信するエンドポイントです。
// 画像そのものは定期同期（server/socialSync.ts → server/socialImages.ts）が公式APIの
// 結果から取得し、Cloudflare KVへ保存済みです。ここではKVから読み出して返すだけで、
// SNS側の画像URL（時間が経つと無効になる署名付きURL）へは一切アクセスしません。
//
// 画像IDには投稿IDと画像パスのハッシュが含まれ、画像が差し替わるとIDも変わるため、
// 長期間のキャッシュ（immutable）を指定しても古い画像が残ることはありません。
// 存在しないIDには404を返し、ページ側は画像なしのカード表示に切り替えます。

import type { SocialSyncEnv } from "../../server/env";
import { IMAGE_ID_PATTERN, imageKvKey } from "../../server/socialImages";

interface ImageMetadata {
  contentType?: string;
}

const ALLOWED_CONTENT_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"];

function notFound(): Response {
  return new Response("Not Found", {
    status: 404,
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      // 画像の保存が後から完了する場合があるため、404は短時間だけキャッシュする
      "Cache-Control": "public, max-age=60",
    },
  });
}

async function handleGet(context: Parameters<PagesFunction<SocialSyncEnv>>[0]): Promise<Response> {
  const imageId = new URL(context.request.url).searchParams.get("k") ?? "";
  if (!IMAGE_ID_PATTERN.test(imageId)) return notFound();

  let stored: { value: ArrayBuffer | null; metadata: ImageMetadata | null };
  try {
    stored = await context.env.SOCIAL_POSTS_KV.getWithMetadata<ImageMetadata>(imageKvKey(imageId), "arrayBuffer");
  } catch {
    return notFound();
  }
  if (!stored.value) return notFound();

  const contentType = stored.metadata?.contentType ?? "";
  if (!ALLOWED_CONTENT_TYPES.includes(contentType)) return notFound();

  return new Response(stored.value, {
    status: 200,
    headers: {
      "Content-Type": contentType,
      "Cache-Control": "public, max-age=31536000, immutable",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

export const onRequestGet: PagesFunction<SocialSyncEnv> = async (context) => handleGet(context);

export const onRequest: PagesFunction<SocialSyncEnv> = async (context) => {
  if (context.request.method !== "GET" && context.request.method !== "HEAD") {
    return new Response(JSON.stringify({ ok: false, error: "method_not_allowed" }), {
      status: 405,
      headers: { "Content-Type": "application/json; charset=utf-8", Allow: "GET" },
    });
  }
  return handleGet(context);
};
