// GA4 Data API の中継（Cloud Run で動かす）。秘密鍵を使わずに GA4 を読むための仕組みです。
//
// ・GA4 へのアクセストークンは、Cloud Run に割り当てたサービスアカウントの権限で、メタデータサーバーから取得します
//   （JSON秘密鍵は作らない・使わない）。スコープは analytics.readonly（読み取りのみ）。
// ・呼び出し元（Cloudflare Pages Functions）は、共有シークレットで HMAC-SHA256 署名したリクエストを送ります。
//   署名・時刻（±120秒）・使い捨ての値（nonce：再送の拒否）を確かめてから GA4 へ転送します。
// ・転送できるのは runReport と batchRunReports だけで、プロパティIDはこの中継の設定で固定です（呼び出し側から変えられない）。
// ・Google のエラー本文・トークン・シークレットは、応答にもログにも出しません（ログはイベント名と種類だけ）。
// ・数値を作ったり補ったりはしません。GA4 の応答をそのまま返すか、エラーの種類だけを返します。
//
// 署名の作り方（Cloudflare 側 server/ga4Proxy.ts と同じ）:
//   文字列 = "GA4PROXY1\n" + 時刻(UNIX秒) + "\n" + nonce + "\n" + "POST" + "\n" + パス + "\n" + 本文のSHA-256(16進)
//   ヘッダー X-Ga4-Proxy-Signature = "v1=" + HMAC-SHA256(シークレット, 文字列) の16進

import { createHash, createHmac, timingSafeEqual } from "node:crypto";

export const SIGNATURE_VERSION = "GA4PROXY1";
export const GA4_SCOPE = "https://www.googleapis.com/auth/analytics.readonly";
export const DATA_API_BASE = "https://analyticsdata.googleapis.com/v1beta/properties/";
export const DEFAULT_METADATA_TOKEN_URL =
  "http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token";

/** 許可する時刻のずれ（秒） */
export const MAX_CLOCK_SKEW_SECONDS = 120;
/** 本文の上限（バイト） */
export const MAX_BODY_BYTES = 32 * 1024;
/** シークレットの最低の長さ（文字） */
export const MIN_SECRET_LENGTH = 32;
/** batchRunReports の1回あたりのレポート数の上限（GA4の上限も5） */
export const MAX_BATCH_REQUESTS = 5;
/** 1レポートあたりの行数（limit）の上限 */
export const MAX_ROW_LIMIT = 1000;
/** 稼働確認のパス。Cloud Run では末尾が z のパス（/healthz など）は予約済みで使えない */
export const HEALTH_CHECK_PATH = "/health-check";

const ALLOWED_METHODS = new Set(["runReport", "batchRunReports"]);
const NONCE_PATTERN = /^[A-Za-z0-9_-]{16,64}$/;
const TOKEN_REFRESH_MARGIN_MS = 5 * 60 * 1000;
const UPSTREAM_TIMEOUT_MS = 10_000;

export const sha256Hex = (data) => createHash("sha256").update(data).digest("hex");

export function canonicalString({ timestamp, nonce, path, bodyHash }) {
  return [SIGNATURE_VERSION, timestamp, nonce, "POST", path, bodyHash].join("\n");
}

export function signCanonical(secret, canonical) {
  return `v1=${createHmac("sha256", secret).update(canonical).digest("hex")}`;
}

function safeEqual(a, b) {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

/** 起動時の設定を読む。不正なら null（値そのものは返さない・記録しない） */
export function readProxyConfig(env) {
  const propertyId = (env.GA4_PROPERTY_ID ?? "").trim();
  const secrets = [env.PROXY_HMAC_SECRET, env.PROXY_HMAC_SECRET_PREVIOUS]
    .map((s) => (s ?? "").trim())
    .filter(Boolean);
  if (!/^\d+$/.test(propertyId)) return { ok: false, issue: "property_id" };
  if (secrets.length === 0 || secrets.some((s) => s.length < MIN_SECRET_LENGTH)) return { ok: false, issue: "secret" };
  const num = (value, fallback) => {
    const n = Number(value);
    return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
  };
  return {
    ok: true,
    config: {
      propertyId,
      secrets,
      perMinute: num(env.PROXY_RATE_PER_MINUTE, 60),
      perDay: num(env.PROXY_RATE_PER_DAY, 2000),
      metadataTokenUrl: env.PROXY_METADATA_TOKEN_URL || DEFAULT_METADATA_TOKEN_URL,
    },
  };
}

/** 本文を確かめる。プロパティの指定・大きすぎる要求は受け付けない */
export function validateReportBody(method, body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) return false;
  if ("property" in body) return false;
  const checkOne = (r) =>
    r &&
    typeof r === "object" &&
    !Array.isArray(r) &&
    !("property" in r) &&
    (r.limit === undefined || (Number.isInteger(Number(r.limit)) && Number(r.limit) > 0 && Number(r.limit) <= MAX_ROW_LIMIT));
  if (method === "batchRunReports") {
    const keys = Object.keys(body);
    if (keys.some((k) => k !== "requests")) return false;
    return Array.isArray(body.requests) && body.requests.length >= 1 && body.requests.length <= MAX_BATCH_REQUESTS && body.requests.every(checkOne);
  }
  return checkOne(body);
}

/** 固定窓のレート制限（1分あたり・1日あたり）。インスタンスごと（Cloud Run は最大1インスタンスで動かす） */
export class RateLimiter {
  constructor(perMinute, perDay) {
    this.perMinute = perMinute;
    this.perDay = perDay;
    this.minute = { start: 0, count: 0 };
    this.day = { start: 0, count: 0 };
  }
  take(nowMs) {
    const minuteStart = Math.floor(nowMs / 60_000);
    const dayStart = Math.floor(nowMs / 86_400_000);
    if (this.minute.start !== minuteStart) this.minute = { start: minuteStart, count: 0 };
    if (this.day.start !== dayStart) this.day = { start: dayStart, count: 0 };
    if (this.minute.count >= this.perMinute || this.day.count >= this.perDay) return false;
    this.minute.count++;
    this.day.count++;
    return true;
  }
}

/** 使用済みの nonce（署名が正しいリクエストのものだけを、時刻の許容幅の2倍の間覚える） */
export class NonceStore {
  constructor(ttlMs = MAX_CLOCK_SKEW_SECONDS * 2 * 1000, maxSize = 20_000) {
    this.ttlMs = ttlMs;
    this.maxSize = maxSize;
    this.seen = new Map();
  }
  /** 初めてなら true（記録する）、使用済みなら false */
  use(nonce, nowMs) {
    for (const [key, expiresAt] of this.seen) {
      if (expiresAt > nowMs) break; // 挿入順＝期限順なので、期限内のものが来たら打ち切る
      this.seen.delete(key);
    }
    if (this.seen.has(nonce)) return false;
    if (this.seen.size >= this.maxSize) return false; // 想定外に多いときは安全側（拒否）に倒す
    this.seen.set(nonce, nowMs + this.ttlMs);
    return true;
  }
}

const reply = (status, payload) => ({ status, body: payload === undefined ? "" : JSON.stringify(payload) });

/**
 * 中継の本体。HTTPの入出力から切り離してあり、テストでそのまま呼べる。
 * deps.fetch：GA4・メタデータサーバーへの通信（テストでは偽物）、deps.now：現在時刻（ミリ秒）、deps.log：ログ出力
 */
export function createProxy(config, deps = {}) {
  const fetchFn = deps.fetch ?? ((url, init) => fetch(url, init));
  const now = deps.now ?? Date.now;
  const log = deps.log ?? ((entry) => console.log(JSON.stringify(entry)));
  const limiter = new RateLimiter(config.perMinute, config.perDay);
  const nonces = new NonceStore();
  let token = null;
  // 署名の失敗が大量に来てもログが膨らまないよう、1分ごとに件数だけをまとめて出す
  const rejected = { minute: -1, count: 0 };
  const noteRejected = (reason, nowMs) => {
    const minute = Math.floor(nowMs / 60_000);
    if (rejected.minute !== minute) {
      if (rejected.count > 0) log({ event: "ga4-proxy-rejected-summary", count: rejected.count });
      rejected.minute = minute;
      rejected.count = 0;
      log({ event: "ga4-proxy-rejected", reason });
    }
    rejected.count++;
  };

  async function getToken(nowMs) {
    if (token && token.expiresAt - TOKEN_REFRESH_MARGIN_MS > nowMs) return token.value;
    const url = `${config.metadataTokenUrl}?scopes=${encodeURIComponent(GA4_SCOPE)}`;
    let res;
    try {
      res = await fetchFn(url, { headers: { "Metadata-Flavor": "Google" }, signal: AbortSignal.timeout(5_000) });
    } catch {
      throw new Error("token_unavailable");
    }
    if (!res.ok) {
      await res.body?.cancel().catch(() => {});
      throw new Error("token_unavailable");
    }
    const data = await res.json().catch(() => null);
    if (!data || typeof data.access_token !== "string" || !data.access_token) throw new Error("token_unavailable");
    const expiresIn = typeof data.expires_in === "number" && data.expires_in > 0 ? data.expires_in : 300;
    token = { value: data.access_token, expiresAt: nowMs + expiresIn * 1000 };
    return token.value;
  }

  /**
   * request: { method, path, headers（小文字のキー）, body（Buffer または文字列） }
   * 戻り値: { status, body（JSON文字列 or 空） }
   */
  async function handle(request) {
    const nowMs = now();
    // Cloud Run（*.run.app）は末尾が z のパス（/healthz など）を予約しており、コンテナに届く前に Google が 404 を返す。
    // そのため稼働確認は /health-check を使う（setup.sh・remote-check.mjs・selftest.mjs・テストと同じパス）。
    if (request.method === "GET" && request.path === HEALTH_CHECK_PATH) return { status: 204, body: "" };
    const match = /^\/v1\/([A-Za-z]+)$/.exec(request.path);
    if (request.method !== "POST" || !match || !ALLOWED_METHODS.has(match[1])) return reply(404);
    const method = match[1];
    const headers = request.headers ?? {};
    const body = Buffer.isBuffer(request.body) ? request.body : Buffer.from(request.body ?? "", "utf8");
    if (body.length > MAX_BODY_BYTES) return reply(413, { error: "too_large" });

    // ---- 署名・時刻・nonce ----
    const timestamp = String(headers["x-ga4-proxy-timestamp"] ?? "");
    const nonce = String(headers["x-ga4-proxy-nonce"] ?? "");
    const signature = String(headers["x-ga4-proxy-signature"] ?? "");
    if (!/^\d{9,11}$/.test(timestamp) || !NONCE_PATTERN.test(nonce) || !/^v1=[0-9a-f]{64}$/.test(signature)) {
      noteRejected("malformed", nowMs);
      return reply(401, { error: "unauthorized" });
    }
    const canonical = canonicalString({ timestamp, nonce, path: request.path, bodyHash: sha256Hex(body) });
    if (!config.secrets.some((secret) => safeEqual(signCanonical(secret, canonical), signature))) {
      noteRejected("bad_signature", nowMs);
      return reply(401, { error: "unauthorized" });
    }
    if (Math.abs(Math.floor(nowMs / 1000) - Number(timestamp)) > MAX_CLOCK_SKEW_SECONDS) {
      noteRejected("stale", nowMs);
      return reply(401, { error: "unauthorized" });
    }
    if (!nonces.use(nonce, nowMs)) {
      noteRejected("replay", nowMs);
      return reply(401, { error: "unauthorized" });
    }
    // ---- レート制限（署名が正しいものだけ数える） ----
    if (!limiter.take(nowMs)) {
      log({ event: "ga4-proxy-error", kind: "rate_limited" });
      return reply(429, { error: "rate_limited" });
    }
    // ---- 本文 ----
    let parsed;
    try {
      parsed = JSON.parse(body.toString("utf8"));
    } catch {
      return reply(400, { error: "bad_request" });
    }
    if (!validateReportBody(method, parsed)) return reply(400, { error: "bad_request" });

    // ---- GA4 へ転送 ----
    let accessToken;
    try {
      accessToken = await getToken(nowMs);
    } catch {
      log({ event: "ga4-proxy-error", kind: "token_unavailable" });
      return reply(502, { error: "token_unavailable" });
    }
    let res;
    try {
      res = await fetchFn(`${DATA_API_BASE}${config.propertyId}:${method}`, {
        method: "POST",
        headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
        body: JSON.stringify(parsed),
        signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
      });
    } catch {
      log({ event: "ga4-proxy-error", kind: "upstream_unreachable" });
      return reply(502, { error: "upstream_unreachable" });
    }
    if (!res.ok) {
      await res.body?.cancel().catch(() => {}); // Google のエラー本文は読まずに捨てる
      if (res.status === 401) token = null;
      const kind = res.status === 401 || res.status === 403 ? "upstream_forbidden" : res.status === 429 ? "upstream_rate_limited" : "upstream_error";
      log({ event: "ga4-proxy-error", kind, status: res.status });
      return reply(kind === "upstream_rate_limited" ? 429 : 502, { error: kind });
    }
    const data = await res.text();
    try {
      JSON.parse(data);
    } catch {
      log({ event: "ga4-proxy-error", kind: "upstream_error" });
      return reply(502, { error: "upstream_error" });
    }
    return { status: 200, body: data };
  }

  return { handle };
}
