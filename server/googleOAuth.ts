// Googleアカウントでのログイン（OpenID Connect・認可コードフロー＋PKCE）です。
//
// ・state  … ログイン開始時の値をCookieに保存し、コールバックで一致を確認（ログインCSRF対策）
// ・PKCE   … code_verifier をCookieに保存し、S256のcode_challengeをGoogleへ送る（認可コード横取り対策）
// ・nonce  … IDトークンに埋め込まれた値がCookieの値と一致することを確認（IDトークン再利用対策）
//
// IDトークンは、GoogleのDiscovery Documentに記載された jwks_uri の公開鍵でRS256署名を検証し
// （jose ライブラリ。Web Crypto APIで動作）、さらに iss・aud・exp・iat・nonce・email_verified を検証する。
//
// 失敗時は、原因を切り分けるための理由コード（秘密情報を含まない）を返す。
// 認可コード・トークン・Cookie・メールアドレスは、戻り値にもログにも含めない。

import { createRemoteJWKSet, errors as joseErrors, jwtVerify, type JWTPayload } from "jose";
import { SITE_URL } from "../src/config/siteUrl";
import type { StaffAuthEnv } from "./env";
import { base64Url, getCookie, parseAllowlist, randomToken, safeEqual } from "./staffAuth";

const AUTHORIZE_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const DISCOVERY_URL = "https://accounts.google.com/.well-known/openid-configuration";
const VALID_ISSUERS = ["https://accounts.google.com", "accounts.google.com"];
/** Googleが発行したばかりのIDトークンだけを受け付ける（iat がこれより古ければ拒否） */
const ID_TOKEN_MAX_AGE = "10m";
const CLOCK_TOLERANCE = "60s";
/** 公開鍵のキャッシュ時間（未知の鍵IDが来た場合は、この時間内でも取得し直す） */
const JWKS_CACHE_MS = 60 * 60 * 1000;

export const OAUTH_COOKIE = "staff_oauth";
const OAUTH_COOKIE_PATH = "/staff/auth";
const OAUTH_TTL_SECONDS = 10 * 60;

export const CALLBACK_PATH = "/staff/auth/callback";

/**
 * コールバックURL（https://nobeoka-ugokasu.pages.dev/staff/auth/callback）。
 * Google Cloud Consoleの「承認済みのリダイレクトURI」に同じ値を登録する。
 * 本番URLは src/config/siteUrl.ts で一元管理し、アクセス元のホスト名には依存しない
 * （プレビュー用URL等からのログインは、Google側で登録外のURIとして拒否される）。
 */
export function callbackUrl(): string {
  return `${SITE_URL}${CALLBACK_PATH}`;
}

export function isGoogleConfigured(env: StaffAuthEnv): boolean {
  return Boolean(env.STAFF_DB && env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET && parseAllowlist(env.STAFF_ALLOWED_EMAILS).emails.length > 0);
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
    redirect_uri: callbackUrl(),
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

/** Googleのトークンエンドポイントが返すエラー種別のうち、ログへ記録してよい既知の値 */
const KNOWN_GOOGLE_ERRORS = new Set([
  "invalid_client",
  "invalid_grant",
  "redirect_uri_mismatch",
  "unauthorized_client",
  "invalid_request",
  "unsupported_grant_type",
  "invalid_scope",
]);

/**
 * ログイン失敗の切り分け用の情報（秘密情報・個人情報は含めない）。
 * check … 失敗した確認項目（例: state_mismatch・signature・aud・nonce）
 */
export interface GoogleLoginDiagnostics {
  check?: string;
  googleStatus?: number;
  googleError?: string;
}

export type GoogleLoginResult =
  | { ok: true; email: string }
  | ({ ok: false; reason: "cancelled" | "state_invalid" | "oauth_token_exchange" | "id_token_invalid" | "email_not_verified" } & GoogleLoginDiagnostics);

// ---- Googleの公開鍵（JWKS） ----

let googleJwks: ReturnType<typeof createRemoteJWKSet> | null = null;

/** Discovery Documentの jwks_uri から公開鍵セットを用意する（isolateごとにキャッシュ） */
async function getGoogleJwks(): Promise<ReturnType<typeof createRemoteJWKSet>> {
  if (googleJwks) return googleJwks;
  const res = await fetch(DISCOVERY_URL, { headers: { Accept: "application/json" } });
  if (!res.ok) throw new Error("discovery_unavailable");
  const { jwks_uri: jwksUri } = (await res.json()) as { jwks_uri?: unknown };
  if (typeof jwksUri !== "string" || new URL(jwksUri).protocol !== "https:") throw new Error("discovery_invalid");
  googleJwks = createRemoteJWKSet(new URL(jwksUri), { cacheMaxAge: JWKS_CACHE_MS });
  return googleJwks;
}

/** テスト用：公開鍵のキャッシュを消す */
export function resetGoogleJwksCache(): void {
  googleJwks = null;
}

/** joseの検証エラーを、ログに出してよい短い項目名へ変換する */
function idTokenCheckName(err: unknown): string {
  if (err instanceof joseErrors.JWTExpired) return err.claim;
  if (err instanceof joseErrors.JWTClaimValidationFailed) return err.claim;
  if (err instanceof joseErrors.JWSSignatureVerificationFailed) return "signature";
  if (err instanceof joseErrors.JOSEAlgNotAllowed) return "alg";
  if (err instanceof joseErrors.JWKSNoMatchingKey) return "kid";
  if (err instanceof joseErrors.JWKSTimeout) return "jwks_fetch";
  if (err instanceof joseErrors.JWSInvalid || err instanceof joseErrors.JWTInvalid) return "format";
  if (err instanceof Error && err.message.startsWith("discovery_")) return err.message;
  if (err instanceof joseErrors.JOSEError) return "jwks_fetch";
  return "unknown";
}

/** IDトークンの署名と内容を検証し、検証済みの内容を返す */
async function verifyIdToken(
  idToken: string,
  env: StaffAuthEnv,
  nonce: string,
): Promise<{ ok: true; payload: JWTPayload } | { ok: false; check: string }> {
  let payload: JWTPayload;
  try {
    ({ payload } = await jwtVerify(idToken, await getGoogleJwks(), {
      algorithms: ["RS256"],
      issuer: VALID_ISSUERS,
      audience: env.GOOGLE_CLIENT_ID ?? "",
      maxTokenAge: ID_TOKEN_MAX_AGE,
      clockTolerance: CLOCK_TOLERANCE,
      requiredClaims: ["exp", "iat"],
      currentDate: new Date(Date.now()),
    }));
  } catch (err) {
    return { ok: false, check: idTokenCheckName(err) };
  }
  if (typeof payload.nonce !== "string" || !safeEqual(payload.nonce, nonce)) return { ok: false, check: "nonce" };
  if (typeof payload.email !== "string" || payload.email === "") return { ok: false, check: "email" };
  return { ok: true, payload };
}

/** Googleからのコールバックを検証し、確認済みのメールアドレスを返す（許可リストの確認は呼び出し側） */
export async function completeGoogleLogin(request: Request, env: StaffAuthEnv): Promise<GoogleLoginResult> {
  const url = new URL(request.url);
  if (url.searchParams.get("error")) return { ok: false, reason: "cancelled" };

  const code = url.searchParams.get("code");
  const returnedState = url.searchParams.get("state");
  const oauthCookie = getCookie(request, OAUTH_COOKIE);
  const [state, nonce, verifier] = (oauthCookie ?? "").split(".");
  if (!code || !returnedState) return { ok: false, reason: "state_invalid", check: "missing_params" };
  if (!oauthCookie) return { ok: false, reason: "state_invalid", check: "missing_cookie" };
  if (!state || !nonce || !verifier || !safeEqual(returnedState, state)) {
    return { ok: false, reason: "state_invalid", check: "state_mismatch" };
  }

  let idToken: unknown;
  try {
    const res = await fetch(TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: env.GOOGLE_CLIENT_ID ?? "",
        client_secret: env.GOOGLE_CLIENT_SECRET ?? "",
        redirect_uri: callbackUrl(),
        grant_type: "authorization_code",
        code_verifier: verifier,
      }),
    });
    const body = (await res.json().catch(() => null)) as { id_token?: unknown; error?: unknown } | null;
    if (!res.ok) {
      // error_description などの自由記述は記録しない。既知のエラー種別だけを返す
      const error = typeof body?.error === "string" ? body.error : "";
      return { ok: false, reason: "oauth_token_exchange", googleStatus: res.status, googleError: KNOWN_GOOGLE_ERRORS.has(error) ? error : "other" };
    }
    idToken = body?.id_token;
    if (typeof idToken !== "string" || idToken === "") {
      return { ok: false, reason: "oauth_token_exchange", googleStatus: res.status, check: "missing_id_token" };
    }
  } catch {
    return { ok: false, reason: "oauth_token_exchange", check: "network" };
  }

  const verified = await verifyIdToken(idToken, env, nonce);
  if (!verified.ok) return { ok: false, reason: "id_token_invalid", check: verified.check };
  const { payload } = verified;
  if (payload.email_verified !== true && payload.email_verified !== "true") {
    return { ok: false, reason: "email_not_verified" };
  }
  return { ok: true, email: (payload.email as string).toLowerCase() };
}
