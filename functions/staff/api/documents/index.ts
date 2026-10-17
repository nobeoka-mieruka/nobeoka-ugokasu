// GET  /staff/api/documents … 資料の一覧（削除済みを除く。執行部内部用のため /staff/ 配下でのみ提供）
// POST /staff/api/documents … 新規登録
// ログイン確認・Origin・CSRFトークンの検証は functions/staff/_middleware.ts が行います。

import type { StaffAuthEnv } from "../../../../server/env";
import { createDocument, listDocuments, validateDocumentInput } from "../../../../server/documents";
import { apiError, json, readJsonBody, requireStaff, storageError } from "../../../../server/staffApi";

export const onRequestGet: PagesFunction<StaffAuthEnv> = async ({ env, data }) => {
  const auth = requireStaff(data, "documents:read");
  if ("response" in auth) return auth.response;
  if (!env.STAFF_DB) return apiError(503, "storage_unavailable");
  try {
    return json({ ok: true, documents: await listDocuments(env.STAFF_DB) });
  } catch (err) {
    return storageError("document.list", err);
  }
};

export const onRequestPost: PagesFunction<StaffAuthEnv> = async ({ request, env, data }) => {
  const auth = requireStaff(data, "documents:write");
  if ("response" in auth) return auth.response;
  if (!env.STAFF_DB) return apiError(503, "storage_unavailable");
  const body = await readJsonBody(request);
  if (!body.ok) return body.response;
  const input = validateDocumentInput(body.body);
  if (!input.ok) return apiError(422, "validation_failed", { fields: input.errors });
  try {
    return json({ ok: true, document: await createDocument(env.STAFF_DB, input.value, auth.session.email) }, 201);
  } catch (err) {
    return storageError("document.create", err);
  }
};
