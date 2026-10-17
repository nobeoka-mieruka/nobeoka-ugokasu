// GET  /staff/api/tasks … タスクの一覧（削除済みを除く。執行部内部の情報のため /staff/ 配下でのみ提供）
// POST /staff/api/tasks … 新規登録
// ログイン確認・Origin・CSRFトークンの検証は functions/staff/_middleware.ts が行います。

import type { StaffAuthEnv } from "../../../../server/env";
import { createTask, listTasks, validateTaskInput } from "../../../../server/tasks";
import { apiError, json, readJsonBody, requireStaff, storageError } from "../../../../server/staffApi";

export const onRequestGet: PagesFunction<StaffAuthEnv> = async ({ env, data }) => {
  const auth = requireStaff(data, "tasks:read");
  if ("response" in auth) return auth.response;
  if (!env.STAFF_DB) return apiError(503, "storage_unavailable");
  try {
    return json({ ok: true, tasks: await listTasks(env.STAFF_DB) });
  } catch (err) {
    return storageError("task.list", err);
  }
};

export const onRequestPost: PagesFunction<StaffAuthEnv> = async ({ request, env, data }) => {
  const auth = requireStaff(data, "tasks:write");
  if ("response" in auth) return auth.response;
  if (!env.STAFF_DB) return apiError(503, "storage_unavailable");
  const body = await readJsonBody(request);
  if (!body.ok) return body.response;
  const input = validateTaskInput(body.body);
  if (!input.ok) return apiError(422, "validation_failed", { fields: input.errors });
  try {
    return json({ ok: true, task: await createTask(env.STAFF_DB, input.value, auth.session.email) }, 201);
  } catch (err) {
    return storageError("task.create", err);
  }
};
