// GET /staff/api/analytics?range=today|7d|30d|90d|custom&start=YYYY-MM-DD&end=YYYY-MM-DD
// … アクセス解析（GA4 Data API の読み取り。server/ga4Analytics.ts）。秘密情報・Googleのエラー内容は返しません。
// ログイン確認は functions/staff/_middleware.ts が行います。
//
// 応答：
//   未設定      … { ok: true, configured: false, issue }（画面は設定手順だけを表示し、数値は出さない）
//   取得成功    … { ok: true, configured: true, cached, report }
//   取得失敗    … 502 { ok: false, configured: true, error: "unavailable" }（画面は「未取得」と表示）
//   期間が不正  … 400 { ok: false, error: "invalid_range" }

import type { AnalyticsEnv, StaffAuthEnv } from "../../../server/env";
import { getAnalyticsReport, parseAnalyticsRange } from "../../../server/ga4Analytics";
import { apiError, json, requireStaff } from "../../../server/staffApi";

export const onRequestGet: PagesFunction<StaffAuthEnv & AnalyticsEnv> = async ({ env, data, request }) => {
  const auth = requireStaff(data, "analytics:read");
  if ("response" in auth) return auth.response;
  const range = parseAnalyticsRange(new URL(request.url).searchParams);
  if (!range) return apiError(400, "invalid_range");
  const result = await getAnalyticsReport(env, range);
  return json(result, result.ok ? 200 : 502);
};
