// GA4 中継（Cloud Run の services/ga4-proxy）を呼ぶ処理です（Cloudflare Workers で動作）。
//
// ・組織ポリシーでサービスアカウントの秘密鍵を作れないため、GA4 は Cloud Run の中継が
//   自分のサービスアカウントの権限（鍵なし）で読みます。ここではその中継へ署名付きで問い合わせるだけです。
// ・署名は HMAC-SHA256（WebCrypto）。時刻と使い捨ての値（nonce）を含め、中継側で再送を拒否します。
//   署名の作り方は services/ga4-proxy/src/proxy.mjs と同じです。
// ・シークレット・中継のエラー内容は、ブラウザへ返さず、ログにも出しません。
//
// このファイルは Functions から読み込むため、src/config/siteConfig.ts を import しないでください。

import type { AnalyticsEnv } from "./env";

export const PROXY_SIGNATURE_VERSION = "GA4PROXY1";
/** 中継のシークレットの最低の長さ（中継側と同じ） */
export const MIN_PROXY_SECRET_LENGTH = 32;
const REQUEST_TIMEOUT_MS = 15_000;

export interface Ga4ProxyConfig {
  propertyId: string;
  /** 中継の URL（末尾の / なし。例: https://ga4-proxy-xxxx.a.run.app） */
  baseUrl: string;
  secret: string;
}

export type Ga4ProxySetting =
  | { kind: "none" }
  | { kind: "invalid"; issue: "missing" | "property_id_format" | "proxy_config" }
  | { kind: "ok"; config: Ga4ProxyConfig };

const isLoopback = (url: URL) => url.hostname === "127.0.0.1" || url.hostname === "localhost";

/**
 * 中継の設定を読む。GA4_PROXY_URL・GA4_PROXY_SECRET のどちらも無ければ "none"（従来の方式を使う）。
 * どちらかがあれば中継方式とし、足りない・形式が違うときは未設定として扱う（数値を出さない）。
 */
export function readGa4ProxyConfig(env: AnalyticsEnv): Ga4ProxySetting {
  const rawUrl = (env.GA4_PROXY_URL ?? "").trim();
  const secret = (env.GA4_PROXY_SECRET ?? "").trim();
  if (!rawUrl && !secret) return { kind: "none" };
  const propertyId = (env.GA4_PROPERTY_ID ?? "").trim();
  if (!propertyId || !rawUrl || !secret) return { kind: "invalid", issue: "missing" };
  if (!/^\d+$/.test(propertyId)) return { kind: "invalid", issue: "property_id_format" };
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return { kind: "invalid", issue: "proxy_config" };
  }
  // 通信は HTTPS だけ（ローカルのテスト用に 127.0.0.1・localhost の http は許可）
  const schemeOk = url.protocol === "https:" || (url.protocol === "http:" && isLoopback(url));
  if (!schemeOk || url.username || url.password || url.search || url.hash || secret.length < MIN_PROXY_SECRET_LENGTH) {
    return { kind: "invalid", issue: "proxy_config" };
  }
  return { kind: "ok", config: { propertyId, baseUrl: url.origin + url.pathname.replace(/\/+$/, ""), secret } };
}

const encoder = new TextEncoder();

const toHex = (buffer: ArrayBuffer) => [...new Uint8Array(buffer)].map((b) => b.toString(16).padStart(2, "0")).join("");

function randomNonce(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(18));
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** 署名ヘッダーを作る（中継の proxy.mjs の canonicalString・signCanonical と同じ形式） */
export async function signProxyRequest(
  secret: string,
  path: string,
  body: string,
  nowSeconds: number,
  nonce: string = randomNonce(),
): Promise<Record<string, string>> {
  const bodyHash = toHex(await crypto.subtle.digest("SHA-256", encoder.encode(body)));
  const timestamp = String(nowSeconds);
  const canonical = [PROXY_SIGNATURE_VERSION, timestamp, nonce, "POST", path, bodyHash].join("\n");
  const key = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const signature = toHex(await crypto.subtle.sign("HMAC", key, encoder.encode(canonical)));
  return {
    "X-Ga4-Proxy-Timestamp": timestamp,
    "X-Ga4-Proxy-Nonce": nonce,
    "X-Ga4-Proxy-Signature": `v1=${signature}`,
  };
}

/** 中継の応答の状態を、アクセス解析のエラーの種類に置き換える */
export type ProxyErrorKind = "proxy_rejected" | "api_forbidden" | "rate_limited" | "api_error" | "network_error";

export async function proxyErrorKind(res: Response): Promise<ProxyErrorKind> {
  if (res.status === 401) return "proxy_rejected";
  if (res.status === 429) return "rate_limited";
  const body = (await res.json().catch(() => null)) as { error?: unknown } | null;
  if (body?.error === "upstream_forbidden" || body?.error === "token_unavailable") return "api_forbidden";
  if (body?.error === "upstream_unreachable") return "network_error";
  return "api_error";
}

export const proxyRequestTimeoutMs = REQUEST_TIMEOUT_MS;
