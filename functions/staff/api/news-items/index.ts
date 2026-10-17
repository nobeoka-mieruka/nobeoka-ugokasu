// GET  /staff/api/news-items … お知らせの一覧（削除済みを除く）
// POST /staff/api/news-items … 新規登録
// ログイン確認・Origin・CSRFトークンの検証は functions/staff/_middleware.ts が行います。

import type { StaffAuthEnv } from "../../../../server/env";
import { createNewsItem, listNewsItems, validateNewsInput } from "../../../../server/newsItems";
import { apiError, json, readJsonBody, requireStaff, storageError } from "../../../../server/staffApi";

export const onRequestGet: PagesFunction<StaffAuthEnv> = async ({ env, data }) => {
  const auth = requireStaff(data, "news:read");
  if ("response" in auth) return auth.response;
  if (!env.STAFF_DB) return apiError(503, "storage_unavailable");
  try {
    return json({ ok: true, items: await listNewsItems(env.STAFF_DB) });
  } catch (err) {
    return storageError("news.list", err);
  }
};

export const onRequestPost: PagesFunction<StaffAuthEnv> = async ({ request, env, data }) => {
  const auth = requireStaff(data, "news:write");
  if ("response" in auth) return auth.response;
  if (!env.STAFF_DB) return apiError(503, "storage_unavailable");
  const body = await readJsonBody(request);
  if (!body.ok) return body.response;
  // 新規登録では「サイト更新」は選べない（既存データのためだけに残しているカテゴリー）
  const input = validateNewsInput(body.body);
  if (!input.ok) return apiError(422, "validation_failed", { fields: input.errors });
  try {
    return json({ ok: true, item: await createNewsItem(env.STAFF_DB, input.value, auth.session.email) }, 201);
  } catch (err) {
    return storageError("news.create", err);
  }
};
