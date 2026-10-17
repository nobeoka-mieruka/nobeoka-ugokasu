// GET    /staff/api/events/:id … 1件の取得（編集画面用）
// PUT    /staff/api/events/:id … 編集（全項目。紐づくお知らせも合わせて更新・非公開化）
// PATCH  /staff/api/events/:id … ステータスの変更（status）
// DELETE /staff/api/events/:id … 削除（論理削除。紐づくお知らせは非公開にする）
// ログイン確認・Origin・CSRFトークンの検証は functions/staff/_middleware.ts が行います。

import type { StaffAuthEnv } from "../../../../server/env";
import { changeEventStatus, deleteEvent, getEvent, updateEvent, validateEventInput, validateEventStatusChange } from "../../../../server/events";
import { apiError, json, readJsonBody, requireStaff, storageError } from "../../../../server/staffApi";
import type { StaffPermission } from "../../../../server/staffPermissions";
import { parseId } from "../../../../server/validation";

type Context = EventContext<StaffAuthEnv, "id", Record<string, unknown>>;

/** 権限・D1・IDを確認し、処理を実行する */
async function withEvent(
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
  withEvent(context, "events:read", async (db, id) => {
    try {
      const event = await getEvent(db, id);
      return event ? json({ ok: true, event }) : apiError(404, "not_found");
    } catch (err) {
      return storageError("event.get", err);
    }
  });

export const onRequestPut: PagesFunction<StaffAuthEnv, "id"> = (context) =>
  withEvent(context, "events:write", async (db, id, actor) => {
    const body = await readJsonBody(context.request);
    if (!body.ok) return body.response;
    const input = validateEventInput(body.body);
    if (!input.ok) return apiError(422, "validation_failed", { fields: input.errors });
    try {
      const result = await updateEvent(db, id, input.value, actor);
      return result ? json({ ok: true, event: result.event, news: result.news }) : apiError(404, "not_found");
    } catch (err) {
      return storageError("event.update", err);
    }
  });

export const onRequestPatch: PagesFunction<StaffAuthEnv, "id"> = (context) =>
  withEvent(context, "events:write", async (db, id, actor) => {
    const body = await readJsonBody(context.request);
    if (!body.ok) return body.response;
    const change = validateEventStatusChange(body.body);
    if (!change.ok) return apiError(422, "validation_failed", { fields: change.errors });
    try {
      const event = await changeEventStatus(db, id, change.value.status, actor);
      return event ? json({ ok: true, event }) : apiError(404, "not_found");
    } catch (err) {
      return storageError("event.status", err);
    }
  });

export const onRequestDelete: PagesFunction<StaffAuthEnv, "id"> = (context) =>
  withEvent(context, "events:write", async (db, id, actor) => {
    try {
      const result = await deleteEvent(db, id, actor);
      return result ? json({ ok: true, news: result.news }) : apiError(404, "not_found");
    } catch (err) {
      return storageError("event.delete", err);
    }
  });
