// GET /staff/auth/callback
// Googleでのログイン後に戻ってくる先です。
// Google側の確認（state・PKCE・nonce・email_verified）→ 許可メールアドレスの確認 → セッション発行、の順に行います。
// 失敗理由は画面に出し分けず、すべて同じメッセージにします（どこで失敗したかを推測させない）。

import type { StaffAuthEnv } from "../../../server/env";
import { clearOAuthCookie, completeGoogleLogin, isGoogleConfigured } from "../../../server/googleOAuth";
import {
  clearFailures,
  clientIp,
  createSession,
  isAllowedEmail,
  isLocked,
  recordFailure,
  redirect,
  sessionCookie,
  withStaffHeaders,
} from "../../../server/staffAuth";

/**
 * SameSite=StrictのCookieは、別サイト（Google）から始まった遷移では送られない。
 * そのため302で /staff/ へ飛ばすとCookieが届かずログイン画面へ戻ってしまう。
 * いったん自サイトのページを表示し、そこから /staff/ へ移動させる。
 */
function successPage(cookies: string[]): Response {
  const headers = new Headers({ "Content-Type": "text/html; charset=utf-8" });
  for (const cookie of cookies) headers.append("Set-Cookie", cookie);
  const html = `<!doctype html><html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex, nofollow"><meta http-equiv="refresh" content="0;url=/staff/"><title>ログインしました</title></head><body style="font-family:sans-serif;text-align:center;padding:4rem 1rem"><p>ログインしました。</p><p><a href="/staff/">執行部ポータルへ進む</a></p></body></html>`;
  return withStaffHeaders(new Response(html, { status: 200, headers }));
}

export const onRequestGet: PagesFunction<StaffAuthEnv> = async (context) => {
  const { request, env } = context;
  const clearOAuth = clearOAuthCookie();
  if (!isGoogleConfigured(env) || !env.STAFF_DB) return redirect("/staff/login/?error=unavailable", 302, [clearOAuth]);
  const db = env.STAFF_DB;
  const ip = clientIp(request);

  try {
    if (await isLocked(db, "ip", ip)) return redirect("/staff/login/?error=locked", 302, [clearOAuth]);

    const result = await completeGoogleLogin(request, env);
    if (!result.ok) {
      // Googleの画面で「キャンセル」した場合は失敗として数えない
      if (result.reason === "cancelled") return redirect("/staff/login/?error=cancelled", 302, [clearOAuth]);
      await recordFailure(db, "ip", ip);
      return redirect("/staff/login/?error=failed", 302, [clearOAuth]);
    }

    if (await isLocked(db, "email", result.email)) {
      await recordFailure(db, "ip", ip);
      return redirect("/staff/login/?error=locked", 302, [clearOAuth]);
    }
    if (!isAllowedEmail(result.email, env)) {
      await recordFailure(db, "ip", ip);
      await recordFailure(db, "email", result.email);
      return redirect("/staff/login/?error=failed", 302, [clearOAuth]);
    }

    const sessionId = await createSession(db, result.email);
    await clearFailures(db, ip, result.email);
    return successPage([sessionCookie(sessionId), clearOAuth]);
  } catch {
    return redirect("/staff/login/?error=unavailable", 302, [clearOAuth]);
  }
};
