// GET /staff/auth/callback
// Googleでのログイン後に戻ってくる先です。
// Google側の確認（state・PKCE・IDトークンの署名とnonce・email_verified）→ 許可メールアドレスの確認 → セッション発行、の順に行います。
//
// 失敗時は理由コード（?error=state_invalid など）を付けてログイン画面へ戻しますが、
// 画面の表示は定型文のみです。原因の切り分けはサーバーログ（staff-login-failed）で行います。
// ログには理由コード・許可リストとの一致有無・件数・GoogleのHTTPステータスとエラー種別だけを記録し、
// Client Secret・認可コード・トークン・Cookie・メールアドレスは記録しません。

import type { StaffAuthEnv } from "../../../server/env";
import { clearOAuthCookie, completeGoogleLogin, type GoogleLoginDiagnostics } from "../../../server/googleOAuth";
import {
  clearFailures,
  clientIp,
  createSession,
  isLocked,
  parseAllowlist,
  recordFailure,
  redirect,
  sessionCookie,
  withStaffHeaders,
} from "../../../server/staffAuth";

type FailureReason =
  | "config_error"
  | "d1_error"
  | "state_invalid"
  | "oauth_token_exchange"
  | "id_token_invalid"
  | "email_not_verified"
  | "email_not_allowed"
  | "session_error";

interface LoginLog extends GoogleLoginDiagnostics {
  allowlistMatch?: boolean;
  allowlistCount?: number;
  allowlistWarnings?: string[];
  configured?: Record<string, boolean>;
}

function logLogin(event: "staff-login-failed" | "staff-login-succeeded", fields: LoginLog & { reason?: FailureReason }): void {
  const line = JSON.stringify({ event, ...fields });
  if (event === "staff-login-failed") console.warn(line);
  else console.log(line);
}

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
  const allowlist = parseAllowlist(env.STAFF_ALLOWED_EMAILS);
  const allowlistInfo: LoginLog = {
    allowlistCount: allowlist.emails.length,
    ...(allowlist.warnings.length > 0 ? { allowlistWarnings: allowlist.warnings } : {}),
  };
  const fail = (reason: FailureReason, fields: LoginLog = {}) => {
    logLogin("staff-login-failed", { reason, ...allowlistInfo, ...fields });
    return redirect(`/staff/login/?error=${reason}`, 302, [clearOAuth]);
  };

  // 設定済みかどうかだけを記録する（値そのものは記録しない）
  const configured = {
    STAFF_DB: Boolean(env.STAFF_DB),
    GOOGLE_CLIENT_ID: Boolean(env.GOOGLE_CLIENT_ID),
    GOOGLE_CLIENT_SECRET: Boolean(env.GOOGLE_CLIENT_SECRET),
    STAFF_ALLOWED_EMAILS: allowlist.emails.length > 0,
  };
  if (!env.STAFF_DB || !Object.values(configured).every(Boolean)) return fail("config_error", { configured });
  const db = env.STAFF_DB;
  const ip = clientIp(request);

  try {
    if (await isLocked(db, "ip", ip)) return redirect("/staff/login/?error=locked", 302, [clearOAuth]);
  } catch {
    return fail("d1_error", { check: "lock_check" });
  }

  const result = await completeGoogleLogin(request, env);
  if (!result.ok) {
    const { ok: _ok, reason, ...diagnostics } = result;
    // Googleの画面で「キャンセル」した場合は失敗として数えない
    if (reason === "cancelled") return redirect("/staff/login/?error=cancelled", 302, [clearOAuth]);
    try {
      await recordFailure(db, "ip", ip);
    } catch {
      return fail("d1_error", { check: "failure_record" });
    }
    return fail(reason, diagnostics);
  }

  try {
    if (await isLocked(db, "email", result.email)) {
      await recordFailure(db, "ip", ip);
      return redirect("/staff/login/?error=locked", 302, [clearOAuth]);
    }
    if (!allowlist.emails.includes(result.email)) {
      await recordFailure(db, "ip", ip);
      await recordFailure(db, "email", result.email);
      return fail("email_not_allowed", { allowlistMatch: false });
    }
  } catch {
    return fail("d1_error", { check: "failure_record" });
  }

  try {
    const sessionId = await createSession(db, result.email);
    await clearFailures(db, ip, result.email);
    logLogin("staff-login-succeeded", { allowlistMatch: true, ...allowlistInfo });
    return successPage([sessionCookie(sessionId), clearOAuth]);
  } catch {
    return fail("session_error", { allowlistMatch: true });
  }
};
