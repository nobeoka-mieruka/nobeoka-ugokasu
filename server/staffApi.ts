// /staff/api/ 配下のAPIで共通に使う処理です。
// ログイン確認・送信元（Origin）・CSRFトークンの検証は functions/staff/_middleware.ts が先に行います。
// ここでは念のためセッションと権限をもう一度確認します（多重の防御）。

import type { StaffSession } from "./staffAuth";
import { withStaffHeaders } from "./staffAuth";
import { hasStaffPermission, type StaffPermission } from "./staffPermissions";

/** 受け付けるリクエスト本文の上限（過大な入力を拒否する） */
export const MAX_JSON_BODY_BYTES = 16 * 1024;

export function json(body: unknown, status = 200): Response {
  return withStaffHeaders(
    new Response(JSON.stringify(body), {
      status,
      headers: { "Content-Type": "application/json; charset=utf-8", "X-Content-Type-Options": "nosniff" },
    }),
  );
}

export const apiError = (status: number, error: string, extra: Record<string, unknown> = {}) => json({ ok: false, error, ...extra }, status);

/** ミドルウェアが確認したセッションを取り出し、権限を確認する。不可なら応答を返す */
export function requireStaff(data: Record<string, unknown>, permission: StaffPermission): { session: StaffSession } | { response: Response } {
  const session = data.staffSession as StaffSession | undefined;
  if (!session) return { response: apiError(401, "unauthorized") };
  if (!hasStaffPermission(session, permission)) return { response: apiError(403, "forbidden") };
  return { session };
}

/** JSON本文を読み取る（Content-Typeと大きさを確認する） */
export async function readJsonBody(request: Request): Promise<{ ok: true; body: unknown } | { ok: false; response: Response }> {
  if (!(request.headers.get("Content-Type") ?? "").includes("application/json")) {
    return { ok: false, response: apiError(415, "unsupported_media_type") };
  }
  const declared = Number(request.headers.get("Content-Length") ?? "0");
  if (declared > MAX_JSON_BODY_BYTES) return { ok: false, response: apiError(413, "payload_too_large") };
  const text = await request.text();
  if (new TextEncoder().encode(text).length > MAX_JSON_BODY_BYTES) return { ok: false, response: apiError(413, "payload_too_large") };
  try {
    return { ok: true, body: JSON.parse(text) };
  } catch {
    return { ok: false, response: apiError(400, "invalid_json") };
  }
}

/** D1の障害時の応答（内部のエラー内容は返さず、ログにもエラーの種類だけを出す） */
export function storageError(operation: string, err: unknown): Response {
  console.error(JSON.stringify({ event: "staff-api-error", operation, error: err instanceof Error ? err.name : "unknown" }));
  return apiError(503, "storage_unavailable");
}
