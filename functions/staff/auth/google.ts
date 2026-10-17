// GET /staff/auth/google
// 「Googleでログイン」ボタンの行き先。state・nonce・PKCEを用意してGoogleのログイン画面へ送ります。
// 設定漏れ・D1の障害はサーバーログ（staff-login-failed）に理由コードだけを記録します（値は記録しない）。

import type { StaffAuthEnv } from "../../../server/env";
import { beginGoogleLogin, isGoogleConfigured } from "../../../server/googleOAuth";
import { clientIp, isLocked, redirect } from "../../../server/staffAuth";

export const onRequestGet: PagesFunction<StaffAuthEnv> = async (context) => {
  const { request, env } = context;
  if (!isGoogleConfigured(env) || !env.STAFF_DB) {
    console.warn(JSON.stringify({ event: "staff-login-failed", reason: "config_error", check: "login_start" }));
    return redirect("/staff/login/?error=config_error");
  }
  try {
    if (await isLocked(env.STAFF_DB, "ip", clientIp(request))) return redirect("/staff/login/?error=locked");
  } catch {
    console.warn(JSON.stringify({ event: "staff-login-failed", reason: "d1_error", check: "login_start" }));
    return redirect("/staff/login/?error=d1_error");
  }
  const { url, cookie } = await beginGoogleLogin(request, env);
  return redirect(url, 302, [cookie]);
};
