// GET /staff/api/sns/status … SNS連携の状態（各SNSの状態・保存済み件数・最終同期日時・直近の投稿）
// SNS自動同期がKVに保存している記録を読むだけで、Meta APIは呼びません。秘密情報は返しません。
// ログイン確認は functions/staff/_middleware.ts が行います。

import type { SocialSyncEnv, StaffAuthEnv } from "../../../../server/env";
import { readSnsStatus } from "../../../../server/snsAdmin";
import { apiError, json, requireStaff, storageError } from "../../../../server/staffApi";

export const onRequestGet: PagesFunction<StaffAuthEnv & SocialSyncEnv> = async ({ env, data }) => {
  const auth = requireStaff(data, "sns:read");
  if ("response" in auth) return auth.response;
  if (!env.STAFF_DB || !env.SOCIAL_POSTS_KV) return apiError(503, "storage_unavailable");
  try {
    return json({ ok: true, status: await readSnsStatus(env, env.STAFF_DB) });
  } catch (err) {
    return storageError("sns.status", err);
  }
};
