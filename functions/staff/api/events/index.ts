// GET  /staff/api/events … イベントの一覧（削除済みを除く。内部管理用の項目を含むため執行部のみ）
// POST /staff/api/events … 新規登録
// ログイン確認・Origin・CSRFトークンの検証は functions/staff/_middleware.ts が行います。

import type { StaffAuthEnv } from "../../../../server/env";
import { createEvent, listEvents, validateEventInput } from "../../../../server/events";
import { apiError, json, readJsonBody, requireStaff, storageError } from "../../../../server/staffApi";

export const onRequestGet: PagesFunction<StaffAuthEnv> = async ({ env, data }) => {
  const auth = requireStaff(data, "events:read");
  if ("response" in auth) return auth.response;
  if (!env.STAFF_DB) return apiError(503, "storage_unavailable");
  try {
    return json({ ok: true, events: await listEvents(env.STAFF_DB) });
  } catch (err) {
    return storageError("event.list", err);
  }
};

export const onRequestPost: PagesFunction<StaffAuthEnv> = async ({ request, env, data }) => {
  const auth = requireStaff(data, "events:write");
  if ("response" in auth) return auth.response;
  if (!env.STAFF_DB) return apiError(503, "storage_unavailable");
  const body = await readJsonBody(request);
  if (!body.ok) return body.response;
  const input = validateEventInput(body.body);
  if (!input.ok) return apiError(422, "validation_failed", { fields: input.errors });
  try {
    const result = await createEvent(env.STAFF_DB, input.value, auth.session.email);
    return json({ ok: true, event: result.event, news: result.news }, 201);
  } catch (err) {
    return storageError("event.create", err);
  }
};
