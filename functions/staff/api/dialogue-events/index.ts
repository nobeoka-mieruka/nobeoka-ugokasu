// GET  /staff/api/dialogue-events … 意見交換会の一覧（削除済みを除く）
// POST /staff/api/dialogue-events … 新規登録
// ログイン確認・Origin・CSRFトークンの検証は functions/staff/_middleware.ts が行います。

import type { StaffAuthEnv } from "../../../../server/env";
import { createDialogueEvent, listDialogueEvents, validateDialogueInput } from "../../../../server/dialogueEvents";
import { apiError, json, readJsonBody, requireStaff, storageError } from "../../../../server/staffApi";

export const onRequestGet: PagesFunction<StaffAuthEnv> = async ({ env, data }) => {
  const auth = requireStaff(data, "dialogue:read");
  if ("response" in auth) return auth.response;
  if (!env.STAFF_DB) return apiError(503, "storage_unavailable");
  try {
    return json({ ok: true, events: await listDialogueEvents(env.STAFF_DB) });
  } catch (err) {
    return storageError("dialogue.list", err);
  }
};

export const onRequestPost: PagesFunction<StaffAuthEnv> = async ({ request, env, data }) => {
  const auth = requireStaff(data, "dialogue:write");
  if ("response" in auth) return auth.response;
  if (!env.STAFF_DB) return apiError(503, "storage_unavailable");
  const body = await readJsonBody(request);
  if (!body.ok) return body.response;
  const input = validateDialogueInput(body.body);
  if (!input.ok) return apiError(422, "validation_failed", { fields: input.errors });
  try {
    return json({ ok: true, event: await createDialogueEvent(env.STAFF_DB, input.value, auth.session.email) }, 201);
  } catch (err) {
    return storageError("dialogue.create", err);
  }
};
