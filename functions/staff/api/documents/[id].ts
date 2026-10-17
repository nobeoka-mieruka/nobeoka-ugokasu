// GET    /staff/api/documents/:id … 1件の取得（編集画面用）
// PUT    /staff/api/documents/:id … 編集（全項目）
// PATCH  /staff/api/documents/:id … ピン留めの切り替え（pinned）
// DELETE /staff/api/documents/:id … 削除（論理削除）
// ログイン確認・Origin・CSRFトークンの検証は functions/staff/_middleware.ts が行います。

import type { StaffAuthEnv } from "../../../../server/env";
import {
  deleteDocument,
  getDocument,
  setDocumentPinned,
  updateDocument,
  validateDocumentInput,
  validatePinChange,
} from "../../../../server/documents";
import { apiError, json, readJsonBody, requireStaff, storageError } from "../../../../server/staffApi";
import type { StaffPermission } from "../../../../server/staffPermissions";
import { parseId } from "../../../../server/validation";

type Context = EventContext<StaffAuthEnv, "id", Record<string, unknown>>;

/** 権限・D1・IDを確認し、処理を実行する */
async function withDocument(
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
  withDocument(context, "documents:read", async (db, id) => {
    try {
      const document = await getDocument(db, id);
      return document ? json({ ok: true, document }) : apiError(404, "not_found");
    } catch (err) {
      return storageError("document.get", err);
    }
  });

export const onRequestPut: PagesFunction<StaffAuthEnv, "id"> = (context) =>
  withDocument(context, "documents:write", async (db, id, actor) => {
    const body = await readJsonBody(context.request);
    if (!body.ok) return body.response;
    const input = validateDocumentInput(body.body);
    if (!input.ok) return apiError(422, "validation_failed", { fields: input.errors });
    try {
      const document = await updateDocument(db, id, input.value, actor);
      return document ? json({ ok: true, document }) : apiError(404, "not_found");
    } catch (err) {
      return storageError("document.update", err);
    }
  });

export const onRequestPatch: PagesFunction<StaffAuthEnv, "id"> = (context) =>
  withDocument(context, "documents:write", async (db, id, actor) => {
    const body = await readJsonBody(context.request);
    if (!body.ok) return body.response;
    const change = validatePinChange(body.body);
    if (!change.ok) return apiError(422, "validation_failed", { fields: change.errors });
    try {
      const document = await setDocumentPinned(db, id, change.value.pinned, actor);
      return document ? json({ ok: true, document }) : apiError(404, "not_found");
    } catch (err) {
      return storageError("document.pin", err);
    }
  });

export const onRequestDelete: PagesFunction<StaffAuthEnv, "id"> = (context) =>
  withDocument(context, "documents:write", async (db, id, actor) => {
    try {
      return (await deleteDocument(db, id, actor)) ? json({ ok: true }) : apiError(404, "not_found");
    } catch (err) {
      return storageError("document.delete", err);
    }
  });
