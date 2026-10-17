// /staff 配下（後援会執行部ポータル）すべてに適用されるミドルウェアです。
//
// ・ログイン画面（/staff/login/）とGoogleログインの開始・コールバックだけは未ログインで利用できる。
// ・それ以外は、有効なセッションが無ければ静的HTMLを返さずに /staff/login/ へリダイレクトする。
//   D1の障害や設定漏れの場合も中身は返さない（フェイルクローズ）。
// ・更新系リクエスト（POST・PUT・PATCH・DELETE）はCSRFトークンと送信元を検証する。
// ・ログイン中のメールアドレスとCSRFトークンは、配信時にHTMLへ差し込む
//  （静的HTML・JavaScriptのソースには含めない）。

import type { StaffAuthEnv } from "../../server/env";
import {
  clearSessionCookie,
  getCookie,
  getSession,
  isAllowedEmail,
  isValidCsrf,
  redirect,
  SESSION_COOKIE,
  withStaffHeaders,
} from "../../server/staffAuth";
import type { StaffSession } from "../../server/staffAuth";

const LOGIN_PAGE = /^\/staff\/login(\/|\/index\.html)?$/;
const AUTH_ENDPOINT = /^\/staff\/auth\/(google|callback)\/?$/;
const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

export const onRequest: PagesFunction<StaffAuthEnv> = async (context) => {
  const { request, env } = context;
  const url = new URL(request.url);
  const path = url.pathname;

  if (AUTH_ENDPOINT.test(path)) return withStaffHeaders(await context.next());

  let session: StaffSession | null = null;
  let sessionError = false;
  if (env.STAFF_DB && getCookie(request, SESSION_COOKIE)) {
    try {
      session = await getSession(env.STAFF_DB, request);
      // 許可リストから外された方は、ログイン中のセッションも直ちに無効にする
      if (session && !isAllowedEmail(session.email, env)) session = null;
    } catch {
      sessionError = true;
    }
  }

  if (LOGIN_PAGE.test(path)) {
    // ログイン済みならポータルへ
    if (session && SAFE_METHODS.has(request.method)) return redirect("/staff/");
    return withStaffHeaders(await context.next());
  }

  if (sessionError) {
    return withStaffHeaders(new Response("一時的にご利用いただけません。時間をおいて再度お試しください。", { status: 503 }));
  }

  if (!session) {
    // 期限切れ・無効なCookieが残っていれば消してからログイン画面へ
    const cookies = getCookie(request, SESSION_COOKIE) ? [clearSessionCookie()] : [];
    if (path.startsWith("/staff/api/")) {
      const res = new Response(JSON.stringify({ ok: false, error: "unauthorized" }), {
        status: 401,
        headers: { "Content-Type": "application/json; charset=utf-8" },
      });
      for (const cookie of cookies) res.headers.append("Set-Cookie", cookie);
      return withStaffHeaders(res);
    }
    return redirect("/staff/login/", SAFE_METHODS.has(request.method) ? 302 : 303, cookies);
  }

  if (!SAFE_METHODS.has(request.method) && !(await isValidCsrf(request, session))) {
    if (path.startsWith("/staff/api/")) {
      return withStaffHeaders(
        new Response(JSON.stringify({ ok: false, error: "csrf_failed" }), {
          status: 403,
          headers: { "Content-Type": "application/json; charset=utf-8" },
        }),
      );
    }
    return withStaffHeaders(new Response("不正なリクエストです。ページを再読み込みしてからやり直してください。", { status: 403 }));
  }

  context.data.staffSession = session;
  const response = await context.next();

  if (!(response.headers.get("Content-Type") ?? "").includes("text/html")) return withStaffHeaders(response);

  const current = session;
  const rewritten = new HTMLRewriter()
    .on("[data-staff-email]", {
      element(el) {
        el.setInnerContent(current.email);
      },
    })
    .on('input[name="csrf_token"]', {
      element(el) {
        el.setAttribute("value", current.csrfToken);
      },
    })
    .on('meta[name="staff-csrf-token"]', {
      element(el) {
        el.setAttribute("content", current.csrfToken);
      },
    })
    .transform(response);
  return withStaffHeaders(rewritten);
};
