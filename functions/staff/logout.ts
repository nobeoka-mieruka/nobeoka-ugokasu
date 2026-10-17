// POST /staff/logout
// セッションの確認とCSRFの検証は functions/staff/_middleware.ts で済んでいます。
// D1のセッションを即時削除し、Cookieも消してログイン画面へ戻します。

import type { StaffAuthEnv } from "../../server/env";
import { clearSessionCookie, deleteSession, redirect } from "../../server/staffAuth";

export const onRequestPost: PagesFunction<StaffAuthEnv> = async (context) => {
  if (context.env.STAFF_DB) await deleteSession(context.env.STAFF_DB, context.request);
  return redirect("/staff/login/?logged_out=1", 303, [clearSessionCookie()]);
};
