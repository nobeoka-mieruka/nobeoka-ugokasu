// テスト用：執行部ポータルのAPI・画面を、本番と同じミドルウェア（functions/staff/_middleware.ts）経由で呼び出す部品です。
// D1は FakeD1（node:sqlite）、静的ファイルは ASSETS の偽物で置き換えます。実際のGoogle・Cloudflareへは一切アクセスしません。

import type { StaffAuthEnv } from "../../../server/env";
import { createSession } from "../../../server/staffAuth";
import { onRequest as staffMiddleware } from "../../../functions/staff/_middleware";
import { FakeD1 } from "./fakeD1";

export const ORIGIN = "https://nobeoka-ugokasu.pages.dev";
export const STAFF = "staff@example.com";

// HTMLRewriterはWorkers専用のため、単体テストでは素通しにする
(globalThis as Record<string, unknown>).HTMLRewriter = class {
  on() {
    return this;
  }
  transform(res: Response) {
    return res;
  }
};

export type Handler = (ctx: never) => Response | Promise<Response>;
export type Router = (method: string, pathname: string) => { handler: Handler | null; params: Record<string, string> };

export interface Auth {
  cookie: string;
  csrf: string;
}

export interface CallOptions {
  method?: string;
  body?: unknown;
  rawBody?: string;
  cookie?: string;
  csrf?: string | null;
  origin?: string | null;
}

export function makeEnv<T extends Record<string, unknown>>(extra: T = {} as T, db = new FakeD1()) {
  return {
    STAFF_DB: db as unknown as D1Database,
    GOOGLE_CLIENT_ID: "test-client-id.apps.googleusercontent.com",
    GOOGLE_CLIENT_SECRET: "test-client-secret",
    STAFF_ALLOWED_EMAILS: STAFF,
    ...extra,
  };
}

export const fakeDb = (env: { STAFF_DB: D1Database }) => env.STAFF_DB as unknown as FakeD1;

/** ログインしてセッションCookieとCSRFトークンを得る */
export async function loginAs(env: { STAFF_DB: D1Database }): Promise<Auth> {
  const sessionId = await createSession(env.STAFF_DB, STAFF);
  const row = await fakeDb(env).prepare("SELECT csrf_token FROM staff_sessions ORDER BY created_at DESC").first<{ csrf_token: string }>();
  return { cookie: `staff_session=${sessionId}`, csrf: row!.csrf_token };
}

const PAGE_HTML = "<html><body><h1>執行部ポータル</h1></body></html>";

/** ミドルウェア → ルーターで選んだ処理、の順に呼び出す */
export function createCaller(router: Router) {
  const assetsRequested: string[] = [];
  async function call(env: Record<string, unknown>, pathname: string, options: CallOptions = {}) {
    const method = options.method ?? "GET";
    const headers = new Headers({ "CF-Connecting-IP": "203.0.113.10" });
    if (options.cookie) headers.set("Cookie", options.cookie);
    if (options.csrf) headers.set("X-CSRF-Token", options.csrf);
    if (method !== "GET") {
      if (options.origin !== null) headers.set("Origin", options.origin ?? ORIGIN);
      headers.set("Content-Type", "application/json");
    }
    const body = options.rawBody ?? (options.body === undefined ? undefined : JSON.stringify(options.body));
    const request = new Request(`${ORIGIN}${pathname}`, { method, headers, body });
    const { handler, params } = router(method, new URL(request.url).pathname);
    const data: Record<string, unknown> = {};
    let reachedHandler = false;
    const fullEnv = {
      ...env,
      ASSETS: {
        fetch: async (input: RequestInfo | URL) => {
          assetsRequested.push(new URL(String(input)).pathname);
          return new Response(PAGE_HTML, { headers: { "Content-Type": "text/html; charset=utf-8" } });
        },
      },
    };
    const ctx = {
      request,
      env: fullEnv,
      data,
      params,
      next: async () => {
        reachedHandler = true;
        if (!handler) return new Response(PAGE_HTML, { headers: { "Content-Type": "text/html; charset=utf-8" } });
        return handler({ request, env: fullEnv, data, params } as never);
      },
    };
    const res = await staffMiddleware(ctx as unknown as EventContext<StaffAuthEnv, string, Record<string, unknown>>);
    const text = await res.text();
    let json: Record<string, unknown> | null = null;
    try {
      json = JSON.parse(text);
    } catch {
      json = null;
    }
    return { res, text, json, reachedHandler };
  }
  return { call, assetsRequested };
}

/** 時刻を進められる Date.now（テスト用） */
export function controllableClock() {
  const realNow = Date.now;
  let offsetMs = 0;
  Date.now = () => realNow() + offsetMs;
  return {
    advance: (ms: number) => {
      offsetMs += ms;
    },
    reset: () => {
      offsetMs = 0;
    },
    restore: () => {
      Date.now = realNow;
    },
  };
}

/** テストの実行と結果表示 */
export function testRunner(beforeEach: () => void) {
  let passed = 0;
  const realLog = console.log;
  async function test(name: string, fn: () => Promise<void> | void) {
    beforeEach();
    try {
      await fn();
      passed++;
      realLog(`✓ ${name}`);
    } catch (err) {
      console.error(`✗ ${name}`);
      throw err;
    }
  }
  return { test, done: () => realLog(`\n${passed}件のテストに合格しました。`) };
}

/** サーバーログ（JSON形式の行）を記録する。秘密情報・メールアドレスが出ていないことの確認用 */
export function captureLogs() {
  const lines: string[] = [];
  const realLog = console.log;
  const realError = console.error;
  const capture =
    (real: (...args: unknown[]) => void) =>
    (...args: unknown[]) => {
      const line = args.map(String).join(" ");
      if (line.startsWith("{")) lines.push(line);
      else real(...args);
    };
  console.log = capture(realLog);
  console.error = capture(realError);
  return {
    lines,
    restore: () => {
      console.log = realLog;
      console.error = realError;
    },
  };
}
