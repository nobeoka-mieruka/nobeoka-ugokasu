// GET /staff/api/site-status … サイトの状態（本番デプロイ・お知らせ・SNS取得・定期チェックの結果）
// 保存済みの記録を読むだけで、外部（Meta API・GitHub）は呼びません。秘密情報は返しません。
// ログイン確認は functions/staff/_middleware.ts が行います。

import type { AssetsEnv, SocialSyncEnv, StaffAuthEnv } from "../../../server/env";
import { readSiteStatus } from "../../../server/siteHealth";
import { apiError, json, requireStaff, storageError } from "../../../server/staffApi";

export const onRequestGet: PagesFunction<StaffAuthEnv & AssetsEnv & Partial<SocialSyncEnv>> = async ({ env, data, request }) => {
  const auth = requireStaff(data, "status:read");
  if ("response" in auth) return auth.response;
  if (!env.STAFF_DB) return apiError(503, "storage_unavailable");
  try {
    return json({ ok: true, status: await readSiteStatus({ ...env, STAFF_DB: env.STAFF_DB }, new URL(request.url).origin) });
  } catch (err) {
    return storageError("site.status", err);
  }
};
