// GET /staff/auth/google
// 「Googleでログイン」ボタンの行き先。state・nonce・PKCEを用意してGoogleのログイン画面へ送ります。

import type { StaffAuthEnv } from "../../../server/env";
import { beginGoogleLogin, isGoogleConfigured } from "../../../server/googleOAuth";
import { clientIp, isLocked, redirect } from "../../../server/staffAuth";

export const onRequestGet: PagesFunction<StaffAuthEnv> = async (context) => {
  const { request, env } = context;
  if (!isGoogleConfigured(env) || !env.STAFF_DB) return redirect("/staff/login/?error=unavailable");
  try {
    if (await isLocked(env.STAFF_DB, "ip", clientIp(request))) return redirect("/staff/login/?error=locked");
  } catch {
    return redirect("/staff/login/?error=unavailable");
  }
  const { url, cookie } = await beginGoogleLogin(request, env);
  return redirect(url, 302, [cookie]);
};
