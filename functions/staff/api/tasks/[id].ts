// GET    /staff/api/tasks/:id … 1件の取得（編集画面用）
// PUT    /staff/api/tasks/:id … 編集（全項目）
// PATCH  /staff/api/tasks/:id … 一覧からの変更（completed・priority・progress のうち指定したもの）
// DELETE /staff/api/tasks/:id … 削除（論理削除）
// ログイン確認・Origin・CSRFトークンの検証は functions/staff/_middleware.ts が行います。

import type { StaffAuthEnv } from "../../../../server/env";
import { deleteTask, getTask, quickChangeTask, updateTask, validateTaskInput, validateTaskQuickChange } from "../../../../server/tasks";
import { apiError, json, readJsonBody, requireStaff, storageError } from "../../../../server/staffApi";
import type { StaffPermission } from "../../../../server/staffPermissions";
import { parseId } from "../../../../server/validation";

type Context = EventContext<StaffAuthEnv, "id", Record<string, unknown>>;

/** 権限・D1・IDを確認し、処理を実行する */
async function withTask(
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
  withTask(context, "tasks:read", async (db, id) => {
    try {
      const task = await getTask(db, id);
      return task ? json({ ok: true, task }) : apiError(404, "not_found");
    } catch (err) {
      return storageError("task.get", err);
    }
  });

export const onRequestPut: PagesFunction<StaffAuthEnv, "id"> = (context) =>
  withTask(context, "tasks:write", async (db, id, actor) => {
    const body = await readJsonBody(context.request);
    if (!body.ok) return body.response;
    const input = validateTaskInput(body.body);
    if (!input.ok) return apiError(422, "validation_failed", { fields: input.errors });
    try {
      const task = await updateTask(db, id, input.value, actor);
      return task ? json({ ok: true, task }) : apiError(404, "not_found");
    } catch (err) {
      return storageError("task.update", err);
    }
  });

export const onRequestPatch: PagesFunction<StaffAuthEnv, "id"> = (context) =>
  withTask(context, "tasks:write", async (db, id, actor) => {
    const body = await readJsonBody(context.request);
    if (!body.ok) return body.response;
    const change = validateTaskQuickChange(body.body);
    if (!change.ok) return apiError(422, "validation_failed", { fields: change.errors });
    try {
      const task = await quickChangeTask(db, id, change.value, actor);
      return task ? json({ ok: true, task }) : apiError(404, "not_found");
    } catch (err) {
      return storageError("task.change", err);
    }
  });

export const onRequestDelete: PagesFunction<StaffAuthEnv, "id"> = (context) =>
  withTask(context, "tasks:write", async (db, id, actor) => {
    try {
      return (await deleteTask(db, id, actor)) ? json({ ok: true }) : apiError(404, "not_found");
    } catch (err) {
      return storageError("task.delete", err);
    }
  });
