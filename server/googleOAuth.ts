// Googleアカウントでのログイン（OpenID Connect・認可コードフロー＋PKCE）です。
//
// ・state  … ログイン開始時の値をCookieに保存し、コールバックで一致を確認（ログインCSRF対策）
// ・PKCE   … code_verifier をCookieに保存し、S256のcode_challengeをGoogleへ送る（認可コード横取り対策）
// ・nonce  … IDトークンに埋め込まれた値がCookieの値と一致することを確認（IDトークン再利用対策）
//
// IDトークンは、ブラウザを経由せずにGoogleのトークンエンドポイントからTLSで直接受け取るため、
// OpenID Connect Core 3.1.3.7 に従い、署名検証の代わりにTLSによる発行元確認を用いる。
// そのうえで iss・aud・exp・nonce・email_verified を必ず検証する。

import type { StaffAuthEnv } from "./env";
import { base64Url, getCookie, randomToken, safeEqual } from "./staffAuth";

const AUTHORIZE_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const VALID_ISSUERS = ["https://accounts.google.com", "accounts.google.com"];

export const OAUTH_COOKIE = "staff_oauth";
const OAUTH_COOKIE_PATH = "/staff/auth";
const OAUTH_TTL_SECONDS = 10 * 60;

/** コールバックURL。Google Cloud Consoleの「承認済みのリダイレクトURI」に同じ値を登録する */
export const CALLBACK_PATH = "/staff/auth/callback";

export function callbackUrl(request: Request): string {
  return `${new URL(request.url).origin}${CALLBACK_PATH}`;
}

export function isGoogleConfigured(env: StaffAuthEnv): boolean {
  return Boolean(env.STAFF_DB && env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET && env.STAFF_ALLOWED_EMAILS?.trim());
}

async function pkceChallenge(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  return base64Url(new Uint8Array(digest));
}

/** Googleのログイン画面へ送るURLと、state等を保存するCookieを作る */
export async function beginGoogleLogin(request: Request, env: StaffAuthEnv): Promise<{ url: string; cookie: string }> {
  const state = randomToken(32);
  const nonce = randomToken(32);
  const verifier = randomToken(48);
  const params = new URLSearchParams({
    client_id: env.GOOGLE_CLIENT_ID ?? "",
    redirect_uri: callbackUrl(request),
    response_type: "code",
    scope: "openid email",
    state,
    nonce,
    code_challenge: await pkceChallenge(verifier),
    code_challenge_method: "S256",
    prompt: "select_account",
  });
  // Googleからのリダイレクト（別サイトからの遷移）でも送られるよう、このCookieだけSameSite=Lax。
  // 10分で失効し、/staff/auth 配下にしか送られない。
  const cookie = `${OAUTH_COOKIE}=${state}.${nonce}.${verifier}; Path=${OAUTH_COOKIE_PATH}; Max-Age=${OAUTH_TTL_SECONDS}; HttpOnly; Secure; SameSite=Lax`;
  return { url: `${AUTHORIZE_URL}?${params}`, cookie };
}

export function clearOAuthCookie(): string {
  return `${OAUTH_COOKIE}=; Path=${OAUTH_COOKIE_PATH}; Max-Age=0; HttpOnly; Secure; SameSite=Lax`;
}

export type GoogleLoginResult =
  | { ok: true; email: string }
  | { ok: false; reason: "cancelled" | "invalid_state" | "token_exchange_failed" | "invalid_id_token" | "email_not_verified" };

function decodeJwtPayload(token: string): Record<string, unknown> | null {
  const part = token.split(".")[1];
  if (!part) return null;
  try {
    const base64 = part.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(part.length / 4) * 4, "=");
    const json = new TextDecoder().decode(Uint8Array.from(atob(base64), (c) => c.charCodeAt(0)));
    const value: unknown = JSON.parse(json);
    return value && typeof value === "object" ? (value as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** Googleからのコールバックを検証し、確認済みのメールアドレスを返す（許可リストの確認は呼び出し側） */
export async function completeGoogleLogin(request: Request, env: StaffAuthEnv): Promise<GoogleLoginResult> {
  const url = new URL(request.url);
  if (url.searchParams.get("error")) return { ok: false, reason: "cancelled" };

  const code = url.searchParams.get("code");
  const returnedState = url.searchParams.get("state");
  const [state, nonce, verifier] = (getCookie(request, OAUTH_COOKIE) ?? "").split(".");
  if (!code || !returnedState || !state || !nonce || !verifier || !safeEqual(returnedState, state)) {
    return { ok: false, reason: "invalid_state" };
  }

  let idToken: string | undefined;
  try {
    const res = await fetch(TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: env.GOOGLE_CLIENT_ID ?? "",
        client_secret: env.GOOGLE_CLIENT_SECRET ?? "",
        redirect_uri: callbackUrl(request),
        grant_type: "authorization_code",
        code_verifier: verifier,
      }),
    });
    if (!res.ok) return { ok: false, reason: "token_exchange_failed" };
    idToken = ((await res.json()) as { id_token?: string }).id_token;
  } catch {
    return { ok: false, reason: "token_exchange_failed" };
  }
  if (!idToken) return { ok: false, reason: "token_exchange_failed" };

  const claims = decodeJwtPayload(idToken);
  const now = Math.floor(Date.now() / 1000);
  const aud = Array.isArray(claims?.aud) ? claims?.aud : [claims?.aud];
  if (
    !claims ||
    typeof claims.iss !== "string" ||
    !VALID_ISSUERS.includes(claims.iss) ||
    !aud.includes(env.GOOGLE_CLIENT_ID) ||
    typeof claims.exp !== "number" ||
    claims.exp < now ||
    typeof claims.nonce !== "string" ||
    !safeEqual(claims.nonce, nonce) ||
    typeof claims.email !== "string" ||
    claims.email === ""
  ) {
    return { ok: false, reason: "invalid_id_token" };
  }
  if (claims.email_verified !== true && claims.email_verified !== "true") {
    return { ok: false, reason: "email_not_verified" };
  }
  return { ok: true, email: claims.email.toLowerCase() };
}
