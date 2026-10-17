// 後援会執行部ポータル（/staff/）のセッション・ログイン試行制限・CSRF対策です。
//
// ・セッションIDは256bitの乱数。Cookieには生の値、D1にはSHA-256ハッシュだけを保存する
//   （D1の中身が漏れても、そこからCookieを作ることはできない）。
// ・有効期限は発行から12時間（延長しない）。ログアウトでD1の行を即時削除する。
// ・Cookie: HttpOnly / Secure / SameSite=Strict / Path=/staff
// ・パスワードは扱わない（Googleアカウントで本人確認する）ため、重いハッシュ計算は不要で、
//   Workers FreeプランのCPU制限内で安定して動作する。

import type { StaffAuthEnv } from "./env";

export const SESSION_COOKIE = "staff_session";
export const SESSION_TTL_SECONDS = 12 * 60 * 60;

/** 失敗をこの回数重ねると、LOCK_SECONDS の間ログインを受け付けない */
export const MAX_LOGIN_FAILURES = 5;
const FAILURE_WINDOW_SECONDS = 15 * 60;
export const LOCK_SECONDS = 15 * 60;

export interface StaffSession {
  email: string;
  csrfToken: string;
  expiresAt: number;
}

// ---- 汎用 ----

const nowSeconds = () => Math.floor(Date.now() / 1000);

export function randomToken(bytes = 32): string {
  const buf = crypto.getRandomValues(new Uint8Array(bytes));
  return base64Url(buf);
}

export function base64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export async function sha256Base64Url(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return base64Url(new Uint8Array(digest));
}

/** 長さ以外の情報を処理時間から推測されないよう、全文字を比較する */
export function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export function getCookie(request: Request, name: string): string | null {
  const header = request.headers.get("Cookie");
  if (!header) return null;
  for (const part of header.split(";")) {
    const index = part.indexOf("=");
    if (index === -1) continue;
    if (part.slice(0, index).trim() === name) return part.slice(index + 1).trim();
  }
  return null;
}

export function sessionCookie(value: string): string {
  return `${SESSION_COOKIE}=${value}; Path=/staff; Max-Age=${SESSION_TTL_SECONDS}; HttpOnly; Secure; SameSite=Strict`;
}

export function clearSessionCookie(): string {
  return `${SESSION_COOKIE}=; Path=/staff; Max-Age=0; HttpOnly; Secure; SameSite=Strict`;
}

/** 許可メールアドレス一覧（環境変数）に含まれるか。大文字・小文字は区別しない */
export function isAllowedEmail(email: string, env: StaffAuthEnv): boolean {
  const allowed = (env.STAFF_ALLOWED_EMAILS ?? "")
    .split(/[\s,;]+/)
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
  const target = email.trim().toLowerCase();
  return target !== "" && allowed.includes(target);
}

export function clientIp(request: Request): string {
  return request.headers.get("CF-Connecting-IP") ?? "unknown";
}

// ---- D1 ----

let schemaReady: WeakSet<D1Database> = new WeakSet();

/** テスト用：スキーマ作成済みの記録を消す */
export function resetSchemaCache(): void {
  schemaReady = new WeakSet();
}

/** 必要なテーブルを（無ければ）作成する。isolateごとに1回だけ実行する */
async function ensureSchema(db: D1Database): Promise<void> {
  if (schemaReady.has(db)) return;
  await db.batch([
    db.prepare(
      `CREATE TABLE IF NOT EXISTS staff_sessions (
        id_hash TEXT PRIMARY KEY,
        email TEXT NOT NULL,
        csrf_token TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        expires_at INTEGER NOT NULL
      )`,
    ),
    db.prepare("CREATE INDEX IF NOT EXISTS staff_sessions_expires ON staff_sessions (expires_at)"),
    db.prepare(
      `CREATE TABLE IF NOT EXISTS staff_login_failures (
        key TEXT PRIMARY KEY,
        count INTEGER NOT NULL,
        window_start INTEGER NOT NULL,
        locked_until INTEGER NOT NULL
      )`,
    ),
  ]);
  schemaReady.add(db);
}

// ---- セッション ----

/** セッションを発行し、Cookieへ入れる生のセッションIDを返す */
export async function createSession(db: D1Database, email: string): Promise<string> {
  await ensureSchema(db);
  const sessionId = randomToken(32); // 256bit
  const now = nowSeconds();
  await db.batch([
    // ついでに期限切れのセッションを掃除する
    db.prepare("DELETE FROM staff_sessions WHERE expires_at <= ?1").bind(now),
    db
      .prepare("INSERT INTO staff_sessions (id_hash, email, csrf_token, created_at, expires_at) VALUES (?1, ?2, ?3, ?4, ?5)")
      .bind(await sha256Base64Url(sessionId), email, randomToken(32), now, now + SESSION_TTL_SECONDS),
  ]);
  return sessionId;
}

/** Cookieのセッションを検証する。無効・期限切れなら null */
export async function getSession(db: D1Database, request: Request): Promise<StaffSession | null> {
  const sessionId = getCookie(request, SESSION_COOKIE);
  // 発行するIDは43文字のbase64url。形式が違うものはD1へ問い合わせずに拒否する
  if (!sessionId || !/^[A-Za-z0-9_-]{43}$/.test(sessionId)) return null;
  await ensureSchema(db);
  const row = await db
    .prepare("SELECT email, csrf_token, expires_at FROM staff_sessions WHERE id_hash = ?1 AND expires_at > ?2")
    .bind(await sha256Base64Url(sessionId), nowSeconds())
    .first<{ email: string; csrf_token: string; expires_at: number }>();
  return row ? { email: row.email, csrfToken: row.csrf_token, expiresAt: row.expires_at } : null;
}

/** ログアウト：D1のセッションを即時削除する */
export async function deleteSession(db: D1Database, request: Request): Promise<void> {
  const sessionId = getCookie(request, SESSION_COOKIE);
  if (!sessionId) return;
  await ensureSchema(db);
  await db.prepare("DELETE FROM staff_sessions WHERE id_hash = ?1").bind(await sha256Base64Url(sessionId)).run();
}

// ---- ログイン試行制限 ----
// IPアドレス単位とアカウント（メールアドレス）単位の両方で数える。
// キーはハッシュ化して保存し、D1にIPアドレスやメールアドレスを平文で残さない。

const failureKey = (kind: "ip" | "email", value: string) => sha256Base64Url(`${kind}:${value.toLowerCase()}`);

export async function isLocked(db: D1Database, kind: "ip" | "email", value: string): Promise<boolean> {
  await ensureSchema(db);
  const row = await db
    .prepare("SELECT locked_until FROM staff_login_failures WHERE key = ?1")
    .bind(await failureKey(kind, value))
    .first<{ locked_until: number }>();
  return Boolean(row && row.locked_until > nowSeconds());
}

export async function recordFailure(db: D1Database, kind: "ip" | "email", value: string): Promise<void> {
  await ensureSchema(db);
  const now = nowSeconds();
  // 前回の失敗から集計期間が過ぎていれば数え直す。上限に達したらロックする
  await db
    .prepare(
      `INSERT INTO staff_login_failures (key, count, window_start, locked_until) VALUES (?1, 1, ?2, 0)
       ON CONFLICT(key) DO UPDATE SET
         count = CASE WHEN window_start <= ?3 THEN 1 ELSE count + 1 END,
         locked_until = CASE
           WHEN (CASE WHEN window_start <= ?3 THEN 1 ELSE count + 1 END) >= ?5 THEN ?4
           ELSE locked_until END,
         window_start = CASE WHEN window_start <= ?3 THEN ?2 ELSE window_start END`,
    )
    .bind(await failureKey(kind, value), now, now - FAILURE_WINDOW_SECONDS, now + LOCK_SECONDS, MAX_LOGIN_FAILURES)
    .run();
}

export async function clearFailures(db: D1Database, ip: string, email: string): Promise<void> {
  await ensureSchema(db);
  await db
    .prepare("DELETE FROM staff_login_failures WHERE key IN (?1, ?2)")
    .bind(await failureKey("ip", ip), await failureKey("email", email))
    .run();
}

// ---- CSRF ----

/**
 * 更新系リクエスト（POST・PUT・PATCH・DELETE）の検証。
 * ① 送信元（Origin、無ければ Sec-Fetch-Site）が同一オリジンであること
 * ② セッションごとのCSRFトークンが一致すること（X-CSRF-Token ヘッダーまたはフォームの csrf_token）
 * の両方を満たした場合のみ true。
 */
export async function isValidCsrf(request: Request, session: StaffSession): Promise<boolean> {
  const url = new URL(request.url);
  const origin = request.headers.get("Origin");
  if (origin !== null) {
    if (origin !== url.origin) return false;
  } else if (request.headers.get("Sec-Fetch-Site") !== "same-origin") {
    return false;
  }

  let token = request.headers.get("X-CSRF-Token");
  if (!token) {
    const contentType = request.headers.get("Content-Type") ?? "";
    if (contentType.includes("application/x-www-form-urlencoded") || contentType.includes("multipart/form-data")) {
      try {
        const value = (await request.clone().formData()).get("csrf_token");
        token = typeof value === "string" ? value : null;
      } catch {
        token = null;
      }
    }
  }
  return Boolean(token) && safeEqual(token as string, session.csrfToken);
}

// ---- 応答 ----

/** /staff 配下のすべての応答に付ける（共有キャッシュ禁止・検索エンジン登録禁止） */
export function withStaffHeaders(response: Response): Response {
  const res = new Response(response.body, response);
  res.headers.set("Cache-Control", "private, no-store");
  res.headers.set("X-Robots-Tag", "noindex, nofollow");
  return res;
}

export function redirect(location: string, status = 302, cookies: string[] = []): Response {
  const headers = new Headers({ Location: location });
  for (const cookie of cookies) headers.append("Set-Cookie", cookie);
  return withStaffHeaders(new Response(null, { status, headers }));
}
