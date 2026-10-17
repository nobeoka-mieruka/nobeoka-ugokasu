// POST /staff/api/sns/sync … 「今すぐ同期」
// 既存のSNS同期処理（runSocialSync）をサーバー側で直接実行します。秘密キー付きの /api/admin/sync-social-posts は使いません。
// ログイン確認・Origin・CSRFトークンの検証は functions/staff/_middleware.ts、連打防止（60秒）は server/snsAdmin.ts が行います。
// 応答は成功／失敗・取得件数・同期日時だけです（トークンやエラーの詳細は返しません）。

import type { SocialSyncEnv, StaffAuthEnv } from "../../../../server/env";
import { runManualSnsSync } from "../../../../server/snsAdmin";
import { apiError, json, requireStaff, storageError } from "../../../../server/staffApi";

export const onRequestPost: PagesFunction<StaffAuthEnv & SocialSyncEnv> = async ({ env, data }) => {
  const auth = requireStaff(data, "sns:write");
  if ("response" in auth) return auth.response;
  if (!env.STAFF_DB || !env.SOCIAL_POSTS_KV) return apiError(503, "storage_unavailable");
  try {
    const result = await runManualSnsSync(env, env.STAFF_DB, auth.session.email);
    if (!result.ok && result.reason === "cooldown") return apiError(429, "cooldown", { retryAt: result.retryAt });
    if (!result.ok) return apiError(502, "sync_failed", { checkedAt: result.checkedAt });
    return json({ ok: true, synced: result.synced, checkedAt: result.checkedAt, counts: result.counts, states: result.states });
  } catch (err) {
    return storageError("sns.sync", err);
  }
};
