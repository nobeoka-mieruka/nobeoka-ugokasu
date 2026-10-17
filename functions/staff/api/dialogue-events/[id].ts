// GET    /staff/api/dialogue-events/:id … 1件の取得（編集画面用）
// PUT    /staff/api/dialogue-events/:id … 編集（全項目）
// PATCH  /staff/api/dialogue-events/:id … 受付状況の変更（status・applicationOpen）
// DELETE /staff/api/dialogue-events/:id … 削除（論理削除）
// ログイン確認・Origin・CSRFトークンの検証は functions/staff/_middleware.ts が行います。

import type { StaffAuthEnv } from "../../../../server/env";
import {
  changeDialogueStatus,
  deleteDialogueEvent,
  getDialogueEvent,
  parseDialogueId,
  updateDialogueEvent,
  validateDialogueInput,
  validateStatusChange,
} from "../../../../server/dialogueEvents";
import { apiError, json, readJsonBody, requireStaff, storageError } from "../../../../server/staffApi";
import type { StaffPermission } from "../../../../server/staffPermissions";

type Context = EventContext<StaffAuthEnv, "id", Record<string, unknown>>;

/** 権限・D1・IDを確認し、処理を実行する */
async function withEvent(
  context: Context,
  permission: StaffPermission,
  handler: (db: D1Database, id: number, actor: string) => Promise<Response>,
): Promise<Response> {
  const auth = requireStaff(context.data, permission);
  if ("response" in auth) return auth.response;
  const id = parseDialogueId(context.params.id);
  if (id === null) return apiError(404, "not_found");
  if (!context.env.STAFF_DB) return apiError(503, "storage_unavailable");
  return handler(context.env.STAFF_DB, id, auth.session.email);
}

export const onRequestGet: PagesFunction<StaffAuthEnv, "id"> = (context) =>
  withEvent(context, "dialogue:read", async (db, id) => {
    try {
      const event = await getDialogueEvent(db, id);
      return event ? json({ ok: true, event }) : apiError(404, "not_found");
    } catch (err) {
      return storageError("dialogue.get", err);
    }
  });

export const onRequestPut: PagesFunction<StaffAuthEnv, "id"> = (context) =>
  withEvent(context, "dialogue:write", async (db, id, actor) => {
    const body = await readJsonBody(context.request);
    if (!body.ok) return body.response;
    const input = validateDialogueInput(body.body);
    if (!input.ok) return apiError(422, "validation_failed", { fields: input.errors });
    try {
      const event = await updateDialogueEvent(db, id, input.value, actor);
      return event ? json({ ok: true, event }) : apiError(404, "not_found");
    } catch (err) {
      return storageError("dialogue.update", err);
    }
  });

export const onRequestPatch: PagesFunction<StaffAuthEnv, "id"> = (context) =>
  withEvent(context, "dialogue:write", async (db, id, actor) => {
    const body = await readJsonBody(context.request);
    if (!body.ok) return body.response;
    const change = validateStatusChange(body.body);
    if (!change.ok) return apiError(422, "validation_failed", { fields: change.errors });
    try {
      const event = await changeDialogueStatus(db, id, change.value, actor);
      return event ? json({ ok: true, event }) : apiError(404, "not_found");
    } catch (err) {
      return storageError("dialogue.status", err);
    }
  });

export const onRequestDelete: PagesFunction<StaffAuthEnv, "id"> = (context) =>
  withEvent(context, "dialogue:write", async (db, id, actor) => {
    try {
      return (await deleteDialogueEvent(db, id, actor)) ? json({ ok: true }) : apiError(404, "not_found");
    } catch (err) {
      return storageError("dialogue.delete", err);
    }
  });
