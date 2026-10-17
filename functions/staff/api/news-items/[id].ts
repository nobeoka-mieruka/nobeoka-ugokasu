// GET    /staff/api/news-items/:id … 1件の取得（編集画面用）
// PUT    /staff/api/news-items/:id … 編集（全項目）
// PATCH  /staff/api/news-items/:id … 公開／非公開の切り替え（isPublished）
// DELETE /staff/api/news-items/:id … 削除（論理削除）
// ログイン確認・Origin・CSRFトークンの検証は functions/staff/_middleware.ts が行います。

import type { StaffAuthEnv } from "../../../../server/env";
import {
  deleteNewsItem,
  getNewsItem,
  setNewsPublished,
  updateNewsItem,
  validateNewsInput,
  validatePublishChange,
} from "../../../../server/newsItems";
import { apiError, json, readJsonBody, requireStaff, storageError } from "../../../../server/staffApi";
import type { StaffPermission } from "../../../../server/staffPermissions";
import { parseId } from "../../../../server/validation";

type Context = EventContext<StaffAuthEnv, "id", Record<string, unknown>>;

/** 権限・D1・IDを確認し、処理を実行する */
async function withItem(
  context: Context,
  permission: StaffPermission,
  handler: (db: D1Database, id: number, actor: string) => Promise<Response>,
): Promise<Response> {
  const auth = requireStaff(context.data, permission);
  if ("response" in auth) return auth.response;
  const id = parseId(context.params.id);
  if (id === null) return apiError(404, "not_found");
  if (!context.env.STAFF_DB) return apiError(503, "storage_unavailable");
  return handler(context.env.STAFF_DB, id, auth.session.email);
}

export const onRequestGet: PagesFunction<StaffAuthEnv, "id"> = (context) =>
  withItem(context, "news:read", async (db, id) => {
    try {
      const item = await getNewsItem(db, id);
      return item ? json({ ok: true, item }) : apiError(404, "not_found");
    } catch (err) {
      return storageError("news.get", err);
    }
  });

export const onRequestPut: PagesFunction<StaffAuthEnv, "id"> = (context) =>
  withItem(context, "news:write", async (db, id, actor) => {
    const body = await readJsonBody(context.request);
    if (!body.ok) return body.response;
    try {
      const current = await getNewsItem(db, id);
      if (!current) return apiError(404, "not_found");
      // 「サイト更新」は、すでにそのカテゴリーのお知らせを編集する場合に限り、そのまま保存できる
      const input = validateNewsInput(body.body, current.category);
      if (!input.ok) return apiError(422, "validation_failed", { fields: input.errors });
      const item = await updateNewsItem(db, id, input.value, actor);
      return item ? json({ ok: true, item }) : apiError(404, "not_found");
    } catch (err) {
      return storageError("news.update", err);
    }
  });

export const onRequestPatch: PagesFunction<StaffAuthEnv, "id"> = (context) =>
  withItem(context, "news:write", async (db, id, actor) => {
    const body = await readJsonBody(context.request);
    if (!body.ok) return body.response;
    const change = validatePublishChange(body.body);
    if (!change.ok) return apiError(422, "validation_failed", { fields: change.errors });
    try {
      const item = await setNewsPublished(db, id, change.value.isPublished, actor);
      return item ? json({ ok: true, item }) : apiError(404, "not_found");
    } catch (err) {
      return storageError("news.publish", err);
    }
  });

export const onRequestDelete: PagesFunction<StaffAuthEnv, "id"> = (context) =>
  withItem(context, "news:write", async (db, id, actor) => {
    try {
      return (await deleteNewsItem(db, id, actor)) ? json({ ok: true }) : apiError(404, "not_found");
    } catch (err) {
      return storageError("news.delete", err);
    }
  });
