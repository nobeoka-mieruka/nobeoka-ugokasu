// 執行部ポータル「アクセス解析」（/staff/analytics/）のための、GA4 Data API の読み取り処理です（Cloudflare Workers で動作）。
//
// ・GA4のプロパティ（数字のプロパティID。G- で始まる測定IDとは別）に、閲覧者権限だけを持つサービスアカウントで接続します。
//   接続のしかたは2通りです（設定手順は docs/analytics-dashboard.md を参照）。
//   1) 中継方式（推奨・秘密鍵なし）：GA4_PROXY_URL・GA4_PROXY_SECRET があるとき。Cloud Run の中継
//      （services/ga4-proxy）が自分のサービスアカウントの権限で GA4 を読み、ここからは署名付きで問い合わせる（server/ga4Proxy.ts）。
//   2) 鍵方式（従来）：サービスアカウントの秘密鍵で署名したJWT（RS256・WebCrypto）を Google のトークン発行先で
//      アクセストークン（読み取り専用スコープ）に交換する。組織ポリシーで鍵を作れない環境では使えない。
// ・取得結果は1時間（「今日」は15分）キャッシュし、GA4 API の呼び出し回数を抑えます。アクセストークンも期限の少し前まで使い回します。
// ・Googleからのエラー本文・秘密鍵・アクセストークンは、ブラウザへ返さず、ログにも出しません（ログはエラーの種類だけ）。
// ・数値はGA4から取得した実データだけを返します。見本の数値や推定値で埋めることはしません。
//
// このファイルは Functions から読み込むため、src/config/siteConfig.ts を import しないでください。

import { todayInJapan } from "../src/utils/dialogueEvents";
import type { AnalyticsEnv } from "./env";
import { proxyErrorKind, proxyRequestTimeoutMs, readGa4ProxyConfig, signProxyRequest, type Ga4ProxyConfig } from "./ga4Proxy";
import type {
  AnalyticsApiResponse,
  AnalyticsBreakdownRow,
  AnalyticsDailyPoint,
  AnalyticsEventRow,
  AnalyticsRange,
  AnalyticsRangeKey,
  AnalyticsReport,
  AnalyticsTopPage,
  AnalyticsTotals,
  AnalyticsTransitionRow,
} from "../src/types/analytics";

export type Ga4Env = AnalyticsEnv;

export const GA4_SCOPE = "https://www.googleapis.com/auth/analytics.readonly";
export const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const DATA_API_BASE = "https://analyticsdata.googleapis.com/v1beta/properties/";

/** キャッシュの有効期間（秒） */
export const REPORT_CACHE_TTL_SECONDS = 60 * 60;
export const TODAY_CACHE_TTL_SECONDS = 15 * 60;
/** 期間指定で選べる最大日数 */
export const MAX_RANGE_DAYS = 400;
/** GA4でデータを取得できる最も古い日付 */
const GA4_EARLIEST_DATE = "2015-08-14";
const REQUEST_TIMEOUT_MS = 10_000;

// ---- 設定 ----

export interface Ga4Config {
  propertyId: string;
  clientEmail: string;
  privateKeyPem: string;
}

/** 環境変数から設定を読む。どれかが無い・形式が違うときは未設定として扱う（数値を出さない） */
export function readGa4Config(env: Ga4Env): { ok: true; config: Ga4Config } | { ok: false; issue: "missing" | "property_id_format" } {
  const propertyId = (env.GA4_PROPERTY_ID ?? "").trim();
  const clientEmail = (env.GA4_SERVICE_ACCOUNT_EMAIL ?? "").trim();
  const privateKeyPem = normalizePrivateKey(env.GA4_SERVICE_ACCOUNT_PRIVATE_KEY ?? "");
  if (!propertyId || !clientEmail || !privateKeyPem) return { ok: false, issue: "missing" };
  if (!/^\d+$/.test(propertyId)) return { ok: false, issue: "property_id_format" };
  if (!clientEmail.includes("@") || !privateKeyPem.includes("PRIVATE KEY")) return { ok: false, issue: "missing" };
  return { ok: true, config: { propertyId, clientEmail, privateKeyPem } };
}

/** JSONキーからコピーしたときに残りやすい「\n」の文字列や前後の引用符を、本来の改行に戻す */
function normalizePrivateKey(value: string): string {
  return value
    .trim()
    .replace(/^"|"$/g, "")
    .replace(/\\n/g, "\n")
    .trim();
}

// ---- 期間（日本時間） ----

const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

function isValidDate(value: string): boolean {
  const match = DATE_PATTERN.exec(value);
  if (!match) return false;
  const [, y, m, d] = match.map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
}

/** "YYYY-MM-DD" に日数を足す（タイムゾーンの影響を受けないようUTCで計算） */
export function addDays(date: string, days: number): string {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

function daysBetween(start: string, end: string): number {
  const toMs = (value: string) => {
    const [y, m, d] = value.split("-").map(Number);
    return Date.UTC(y, m - 1, d);
  };
  return Math.round((toMs(end) - toMs(start)) / 86_400_000) + 1;
}

function withPrevious(key: AnalyticsRangeKey, start: string, end: string): AnalyticsRange {
  const days = daysBetween(start, end);
  const prevEnd = addDays(start, -1);
  return { key, start, end, days, prevStart: addDays(prevEnd, -(days - 1)), prevEnd };
}

/**
 * 期間の指定を読み取る（?range=today|7d|30d|90d|custom&start=&end=）。不正な指定は null。
 * 「過去7日・30日・90日」は、集計が途中の今日を含めず、昨日までの日数とする（GA4の標準と同じ）。
 */
export function parseAnalyticsRange(params: URLSearchParams, now: Date = new Date()): AnalyticsRange | null {
  const today = todayInJapan(now);
  const key = params.get("range") ?? "7d";
  if (key === "today") return withPrevious("today", today, today);
  const fixed: Record<string, number> = { "7d": 7, "30d": 30, "90d": 90 };
  if (key in fixed) {
    const end = addDays(today, -1);
    return withPrevious(key as AnalyticsRangeKey, addDays(end, -(fixed[key] - 1)), end);
  }
  if (key !== "custom") return null;
  const start = params.get("start") ?? "";
  const end = params.get("end") ?? "";
  if (!isValidDate(start) || !isValidDate(end)) return null;
  if (end < start || end > today || start < GA4_EARLIEST_DATE) return null;
  if (daysBetween(start, end) > MAX_RANGE_DAYS) return null;
  return withPrevious("custom", start, end);
}

// ---- 分類（ページ・流入元・端末・イベント） ----

/** ページのパスをそろえる（クエリを除き、末尾に / を付ける。拡張子のあるファイルはそのまま） */
export function normalizePagePath(path: string): string {
  let value = (path || "/").split(/[?#]/)[0].trim();
  if (!value.startsWith("/")) value = `/${value}`;
  const last = value.slice(value.lastIndexOf("/") + 1);
  if (last && !last.includes(".")) value = `${value}/`;
  return value;
}

export const PAGE_GROUPS: readonly { key: string; label: string; match: (path: string) => boolean }[] = [
  { key: "top", label: "トップ", match: (p) => p === "/" },
  { key: "profile", label: "福富千恵について", match: (p) => p === "/profile/" },
  { key: "activities", label: "活動報告", match: (p) => p.startsWith("/activities/") },
  { key: "dialogue", label: "意見交換会", match: (p) => p === "/dialogue/" },
  { key: "voices", label: "みんなの声", match: (p) => p.startsWith("/voices/") },
  { key: "voice_post", label: "みんなの声ポスト", match: (p) => p === "/voice-post/" },
  { key: "supporters_join", label: "後援会入会案内", match: (p) => p === "/supporters/join/" },
  { key: "other", label: "その他", match: () => true },
];

export function pageGroupOf(path: string): { key: string; label: string } {
  const normalized = normalizePagePath(path);
  const group = PAGE_GROUPS.find((g) => g.match(normalized))!;
  return { key: group.key, label: group.label };
}

const CHANNELS: readonly { key: string; label: string; sources: readonly string[] }[] = [
  { key: "search", label: "自然検索", sources: ["Organic Search"] },
  { key: "sns", label: "SNS", sources: ["Organic Social", "Paid Social"] },
  { key: "referral", label: "外部サイト", sources: ["Referral"] },
  { key: "direct", label: "直接アクセス", sources: ["Direct"] },
  { key: "other", label: "その他", sources: [] },
];

export function channelOf(group: string): { key: string; label: string } {
  const found = CHANNELS.find((c) => c.sources.includes(group)) ?? CHANNELS[CHANNELS.length - 1];
  return { key: found.key, label: found.label };
}

const DEVICES: readonly { key: string; label: string }[] = [
  { key: "mobile", label: "スマートフォン" },
  { key: "desktop", label: "パソコン" },
  { key: "tablet", label: "タブレット" },
  { key: "other", label: "その他" },
];

export function deviceOf(category: string): { key: string; label: string } {
  return DEVICES.find((d) => d.key === category.toLowerCase()) ?? DEVICES[DEVICES.length - 1];
}

/** 集計するボタン・リンクのイベント（src/scripts/analyticsBootstrap.ts・docs/analytics-dashboard.md と対応） */
export const TRACKED_EVENTS: readonly { name: string; label: string }[] = [
  { name: "welfare_apply_click", label: "福祉の意見交換会の申込ボタン" },
  { name: "dialogue_apply_click", label: "意見交換会の申込フォームを開くボタン" },
  { name: "voices_form_click", label: "みんなの声（暮らし・地域）のフォームを開くボタン" },
  { name: "voice_form_click", label: "みんなの声のフォームを開くボタン（旧イベント名）" },
  { name: "voice_post_click", label: "みんなの声ポストのフォームを開くボタン" },
  { name: "supporter_join_click", label: "後援会入会申込フォームを開くボタン" },
  { name: "voices_entry_click", label: "みんなの声の窓口カード" },
  { name: "news_detail_click", label: "お知らせの詳細リンク" },
  { name: "activity_read_more", label: "活動報告の「続きを読む」" },
  { name: "supporter_rules_open", label: "後援会規約を開く" },
  { name: "facebook_click", label: "Facebookへのリンク" },
  { name: "instagram_click", label: "Instagramへのリンク" },
  { name: "contact_click", label: "メールでのお問い合わせ" },
];
const EVENT_LABELS = new Map(TRACKED_EVENTS.map((e) => [e.name, e.label]));

/** 申込への遷移率（参考）を出すページと、そのページの申込ボタンのイベント */
export const TRANSITION_PAGES: readonly { path: string; label: string; events: readonly string[] }[] = [
  { path: "/dialogue/", label: "意見交換会", events: ["welfare_apply_click", "dialogue_apply_click"] },
  // voice_form_click は名称変更前（voices_form_click）の同じボタンのイベント
  { path: "/voices/submit/", label: "みんなの声（暮らし・地域の声）", events: ["voices_form_click", "voice_form_click"] },
  { path: "/voice-post/", label: "みんなの声ポスト", events: ["voice_post_click"] },
  { path: "/supporters/join/", label: "後援会入会案内", events: ["supporter_join_click"] },
];

/** ボタンのクリック数 ÷ ページの表示回数 × 100（小数第1位）。表示回数が0なら null（0で割らない） */
export function transitionRate(clicks: number, pageViews: number): number | null {
  if (!Number.isFinite(clicks) || !Number.isFinite(pageViews) || pageViews <= 0) return null;
  return Math.round((clicks / pageViews) * 1000) / 10;
}

/** 前期間比（%・小数第1位）。前期間が0なら null */
export function changePercent(current: number, previous: number): number | null {
  if (!previous) return null;
  return Math.round(((current - previous) / previous) * 1000) / 10;
}

// ---- 認証（サービスアカウントのJWT → アクセストークン） ----

export type Ga4ErrorKind = "invalid_key" | "auth_failed" | "proxy_rejected" | "api_forbidden" | "rate_limited" | "api_error" | "network_error";

export class Ga4Error extends Error {
  constructor(readonly kind: Ga4ErrorKind) {
    super(kind);
    this.name = "Ga4Error";
  }
}

const textEncoder = new TextEncoder();

function base64UrlFromBytes(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

const base64UrlFromText = (text: string) => base64UrlFromBytes(textEncoder.encode(text));

function pkcs8FromPem(pem: string): ArrayBuffer {
  const match = /-----BEGIN PRIVATE KEY-----([\s\S]+?)-----END PRIVATE KEY-----/.exec(pem);
  if (!match) throw new Ga4Error("invalid_key");
  try {
    const binary = atob(match[1].replace(/\s+/g, ""));
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes.buffer;
  } catch {
    throw new Ga4Error("invalid_key");
  }
}

/** サービスアカウントの秘密鍵で署名したJWT（RS256）を作る */
export async function signServiceAccountJwt(config: Ga4Config, nowSeconds: number): Promise<string> {
  let key: CryptoKey;
  try {
    key = await crypto.subtle.importKey("pkcs8", pkcs8FromPem(config.privateKeyPem), { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"]);
  } catch {
    throw new Ga4Error("invalid_key");
  }
  const header = base64UrlFromText(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claims = base64UrlFromText(
    JSON.stringify({ iss: config.clientEmail, scope: GA4_SCOPE, aud: GOOGLE_TOKEN_URL, iat: nowSeconds, exp: nowSeconds + 3600 }),
  );
  const signingInput = `${header}.${claims}`;
  const signature = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, textEncoder.encode(signingInput));
  return `${signingInput}.${base64UrlFromBytes(new Uint8Array(signature))}`;
}

type FetchFn = (input: string, init?: RequestInit) => Promise<Response>;

/** アクセストークンのキャッシュ（同じWorkerの中だけ。保存先には書き込まない） */
const tokenCache = new Map<string, { token: string; expiresAt: number }>();
/** 期限のこれだけ前には新しいトークンに切り替える（ミリ秒） */
const TOKEN_REFRESH_MARGIN_MS = 5 * 60 * 1000;

async function safeFetch(fetchFn: FetchFn, url: string, init: RequestInit): Promise<Response> {
  try {
    return await fetchFn(url, { ...init, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
  } catch {
    throw new Ga4Error("network_error");
  }
}

/** 応答本文は読み捨てる（Googleのエラー本文を保存・表示・記録しない） */
async function discard(res: Response): Promise<void> {
  try {
    await res.body?.cancel();
  } catch {
    // 何もしない
  }
}

export async function getAccessToken(config: Ga4Config, fetchFn: FetchFn, nowMs: number): Promise<string> {
  const cached = tokenCache.get(config.clientEmail);
  if (cached && cached.expiresAt - TOKEN_REFRESH_MARGIN_MS > nowMs) return cached.token;
  const assertion = await signServiceAccountJwt(config, Math.floor(nowMs / 1000));
  const res = await safeFetch(fetchFn, GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion }).toString(),
  });
  if (!res.ok) {
    await discard(res);
    throw new Ga4Error("auth_failed");
  }
  const body = (await res.json().catch(() => null)) as { access_token?: unknown; expires_in?: unknown } | null;
  if (!body || typeof body.access_token !== "string" || !body.access_token) throw new Ga4Error("auth_failed");
  const expiresIn = typeof body.expires_in === "number" && body.expires_in > 0 ? body.expires_in : 3600;
  tokenCache.set(config.clientEmail, { token: body.access_token, expiresAt: nowMs + expiresIn * 1000 });
  return body.access_token;
}

// ---- GA4 Data API ----

interface GaRow {
  dimensionValues?: { value?: string }[];
  metricValues?: { value?: string }[];
}
interface GaReport {
  rows?: GaRow[];
}

const rowsOf = (report: GaReport | undefined) =>
  (report?.rows ?? []).map((row) => ({
    dims: (row.dimensionValues ?? []).map((v) => v.value ?? ""),
    mets: (row.metricValues ?? []).map((v) => Number(v.value ?? 0) || 0),
  }));

async function callDataApi<T>(fetchFn: FetchFn, token: string, propertyId: string, method: string, body: unknown): Promise<T> {
  const res = await safeFetch(fetchFn, `${DATA_API_BASE}${propertyId}:${method}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    await discard(res);
    if (res.status === 401 || res.status === 403) throw new Ga4Error("api_forbidden");
    if (res.status === 429) throw new Ga4Error("rate_limited");
    throw new Ga4Error("api_error");
  }
  const data = (await res.json().catch(() => null)) as T | null;
  if (!data) throw new Ga4Error("api_error");
  return data;
}

/** 中継（Cloud Run）経由で GA4 Data API を呼ぶ。応答は GA4 のものをそのまま受け取る */
async function callProxy<T>(fetchFn: FetchFn, config: Ga4ProxyConfig, method: string, body: unknown, nowMs: number): Promise<T> {
  const path = `/v1/${method}`;
  const text = JSON.stringify(body);
  const headers = await signProxyRequest(config.secret, path, text, Math.floor(nowMs / 1000));
  let res: Response;
  try {
    res = await fetchFn(`${config.baseUrl}${path}`, {
      method: "POST",
      headers: { ...headers, "Content-Type": "application/json" },
      body: text,
      signal: AbortSignal.timeout(proxyRequestTimeoutMs),
    });
  } catch {
    throw new Ga4Error("network_error");
  }
  if (!res.ok) throw new Ga4Error(await proxyErrorKind(res));
  const data = (await res.json().catch(() => null)) as T | null;
  if (!data) throw new Ga4Error("api_error");
  return data;
}

const dateRange = (start: string, end: string, name?: string) => ({ startDate: start, endDate: end, ...(name ? { name } : {}) });
const eventFilter = () => ({ filter: { fieldName: "eventName", inListFilter: { values: TRACKED_EVENTS.map((e) => e.name) } } });

/** 1回目の取得（まとめて5種類）：合計・日別・ページ・流入元・端末 */
export function buildMainBatch(range: AnalyticsRange) {
  const current = [dateRange(range.start, range.end)];
  const totalsMetrics = [{ name: "screenPageViews" }, { name: "totalUsers" }, { name: "sessions" }];
  return {
    requests: [
      { dateRanges: [dateRange(range.start, range.end, "current"), dateRange(range.prevStart, range.prevEnd, "previous")], metrics: totalsMetrics },
      { dateRanges: current, dimensions: [{ name: "date" }], metrics: totalsMetrics, orderBys: [{ dimension: { dimensionName: "date" } }], limit: 500 },
      {
        dateRanges: current,
        dimensions: [{ name: "pagePath" }],
        metrics: [{ name: "screenPageViews" }],
        orderBys: [{ metric: { metricName: "screenPageViews" }, desc: true }],
        limit: 1000,
      },
      { dateRanges: current, dimensions: [{ name: "sessionDefaultChannelGroup" }], metrics: [{ name: "sessions" }], limit: 50 },
      { dateRanges: current, dimensions: [{ name: "deviceCategory" }], metrics: [{ name: "sessions" }], limit: 20 },
    ],
  };
}

/** 2回目：ボタンのクリック（イベント名 × ページ） */
export function buildEventsByPageRequest(range: AnalyticsRange) {
  return {
    dateRanges: [dateRange(range.start, range.end)],
    dimensions: [{ name: "eventName" }, { name: "pagePath" }],
    metrics: [{ name: "eventCount" }],
    dimensionFilter: eventFilter(),
    limit: 1000,
  };
}

/**
 * 3回目：ボタンのクリック（イベント名 × 設置場所）。
 * GA4で content_type をカスタムディメンションとして登録していないとエラーになるため、他と分けて取得し、失敗しても全体は止めない。
 */
export function buildEventsByTypeRequest(range: AnalyticsRange) {
  return {
    dateRanges: [dateRange(range.start, range.end)],
    dimensions: [{ name: "eventName" }, { name: "customEvent:content_type" }],
    metrics: [{ name: "eventCount" }],
    dimensionFilter: eventFilter(),
    limit: 1000,
  };
}

function breakdown(defs: readonly { key: string; label: string }[], values: Map<string, number>): AnalyticsBreakdownRow[] {
  return defs.map((d) => ({ key: d.key, label: d.label, value: values.get(d.key) ?? 0 }));
}

function addTo(map: Map<string, number>, key: string, value: number) {
  map.set(key, (map.get(key) ?? 0) + value);
}

/** GA4の応答を、画面に出す形へまとめる（数値はGA4の値そのまま。足りない日は0で埋める） */
export function assembleReport(
  range: AnalyticsRange,
  main: { reports?: GaReport[] },
  eventsByPage: GaReport,
  eventsByType: GaReport | null,
  fetchedAt: string,
): AnalyticsReport {
  const [totalsReport, dailyReport, pagesReport, channelsReport, devicesReport] = main.reports ?? [];

  const zero = (): AnalyticsTotals => ({ pageViews: 0, users: 0, sessions: 0 });
  const totals = { current: zero(), previous: zero() };
  for (const row of rowsOf(totalsReport)) {
    const target = row.dims.includes("previous") ? totals.previous : totals.current;
    target.pageViews += row.mets[0] ?? 0;
    target.users += row.mets[1] ?? 0;
    target.sessions += row.mets[2] ?? 0;
  }

  const byDate = new Map<string, AnalyticsTotals>();
  for (const row of rowsOf(dailyReport)) {
    const raw = row.dims[0] ?? "";
    if (!/^\d{8}$/.test(raw)) continue;
    byDate.set(`${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}`, { pageViews: row.mets[0] ?? 0, users: row.mets[1] ?? 0, sessions: row.mets[2] ?? 0 });
  }
  const daily: AnalyticsDailyPoint[] = [];
  for (let i = 0; i < range.days; i++) {
    const date = addDays(range.start, i);
    daily.push({ date, ...(byDate.get(date) ?? zero()) });
  }

  const pageViewsByPath = new Map<string, number>();
  for (const row of rowsOf(pagesReport)) addTo(pageViewsByPath, normalizePagePath(row.dims[0] ?? "/"), row.mets[0] ?? 0);
  const groupValues = new Map<string, number>();
  for (const [path, views] of pageViewsByPath) addTo(groupValues, pageGroupOf(path).key, views);
  const topPages: AnalyticsTopPage[] = [...pageViewsByPath]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 20)
    .map(([path, pageViews]) => ({ path, group: pageGroupOf(path).label, pageViews }));

  const channelValues = new Map<string, number>();
  for (const row of rowsOf(channelsReport)) addTo(channelValues, channelOf(row.dims[0] ?? "").key, row.mets[0] ?? 0);
  const deviceValues = new Map<string, number>();
  for (const row of rowsOf(devicesReport)) addTo(deviceValues, deviceOf(row.dims[0] ?? "").key, row.mets[0] ?? 0);

  const clicksByEventPage = new Map<string, number>();
  const clicksByEvent = new Map<string, number>();
  for (const row of rowsOf(eventsByPage)) {
    const name = row.dims[0] ?? "";
    if (!EVENT_LABELS.has(name)) continue;
    addTo(clicksByEventPage, `${name}\u0000${normalizePagePath(row.dims[1] ?? "/")}`, row.mets[0] ?? 0);
    addTo(clicksByEvent, name, row.mets[0] ?? 0);
  }

  const eventOrder = new Map(TRACKED_EVENTS.map((e, i) => [e.name, i]));
  let events: AnalyticsEventRow[];
  if (eventsByType) {
    events = rowsOf(eventsByType)
      .filter((row) => EVENT_LABELS.has(row.dims[0] ?? ""))
      .map((row) => {
        const type = row.dims[1] ?? "";
        return { name: row.dims[0], label: EVENT_LABELS.get(row.dims[0])!, contentType: type && type !== "(not set)" ? type : null, count: row.mets[0] ?? 0 };
      });
  } else {
    events = [...clicksByEvent].map(([name, count]) => ({ name, label: EVENT_LABELS.get(name)!, contentType: null, count }));
  }
  events.sort((a, b) => eventOrder.get(a.name)! - eventOrder.get(b.name)! || b.count - a.count);

  const transitions: AnalyticsTransitionRow[] = TRANSITION_PAGES.map((page) => {
    const pageViews = pageViewsByPath.get(page.path) ?? 0;
    const clicks = page.events.reduce((sum, name) => sum + (clicksByEventPage.get(`${name}\u0000${page.path}`) ?? 0), 0);
    return { path: page.path, label: page.label, events: [...page.events], pageViews, clicks, rate: transitionRate(clicks, pageViews) };
  });

  return {
    range,
    fetchedAt,
    totals,
    daily,
    pageGroups: breakdown(PAGE_GROUPS, groupValues),
    topPages,
    channels: breakdown(CHANNELS, channelValues),
    devices: breakdown(DEVICES, deviceValues),
    events,
    contentTypeAvailable: Boolean(eventsByType),
    transitions,
    formResponses: "unlinked",
  };
}

// ---- キャッシュ ----

const memoryCache = new Map<string, { value: string; expiresAt: number }>();

/** テスト用：メモリ上のキャッシュ（取得結果・アクセストークン）を消す */
export function resetGa4Caches(): void {
  memoryCache.clear();
  tokenCache.clear();
}

export function reportCacheKey(propertyId: string, range: AnalyticsRange): string {
  return `ga4-analytics:report:v1:${propertyId}:${range.key}:${range.start}:${range.end}`;
}

async function readCache(env: Ga4Env, key: string, nowMs: number): Promise<AnalyticsReport | null> {
  let raw: string | null = null;
  if (env.SOCIAL_POSTS_KV) {
    try {
      raw = await env.SOCIAL_POSTS_KV.get(key);
    } catch {
      raw = null;
    }
  } else {
    const entry = memoryCache.get(key);
    raw = entry && entry.expiresAt > nowMs ? entry.value : null;
  }
  if (!raw) return null;
  try {
    return JSON.parse(raw) as AnalyticsReport;
  } catch {
    return null;
  }
}

async function writeCache(env: Ga4Env, key: string, report: AnalyticsReport, ttlSeconds: number, nowMs: number): Promise<void> {
  const value = JSON.stringify(report);
  if (env.SOCIAL_POSTS_KV) {
    try {
      await env.SOCIAL_POSTS_KV.put(key, value, { expirationTtl: ttlSeconds });
    } catch {
      // キャッシュに保存できなくても、取得結果はそのまま返す
    }
    return;
  }
  memoryCache.set(key, { value, expiresAt: nowMs + ttlSeconds * 1000 });
}

// ---- 入口 ----

export interface Ga4Deps {
  fetch?: FetchFn;
  now?: () => number;
}

/** アクセス解析のデータを返す（未設定・取得失敗のときは数値を含めない） */
export async function getAnalyticsReport(env: Ga4Env, range: AnalyticsRange, deps: Ga4Deps = {}): Promise<AnalyticsApiResponse> {
  // 中継の設定（GA4_PROXY_URL・GA4_PROXY_SECRET）があれば中継方式、無ければ従来の鍵方式
  const proxy = readGa4ProxyConfig(env);
  if (proxy.kind === "invalid") return { ok: true, configured: false, issue: proxy.issue };
  let keyConfig: Ga4Config | null = null;
  if (proxy.kind === "none") {
    const setting = readGa4Config(env);
    if (!setting.ok) return { ok: true, configured: false, issue: setting.issue };
    keyConfig = setting.config;
  }
  const propertyId = proxy.kind === "ok" ? proxy.config.propertyId : keyConfig!.propertyId;
  const fetchFn: FetchFn = deps.fetch ?? ((input, init) => fetch(input, init));
  const nowMs = (deps.now ?? Date.now)();

  const cacheKey = reportCacheKey(propertyId, range);
  const cached = await readCache(env, cacheKey, nowMs);
  if (cached) return { ok: true, configured: true, cached: true, report: cached };

  try {
    let call: <T>(method: string, body: unknown) => Promise<T>;
    if (proxy.kind === "ok") {
      const proxyConfig = proxy.config;
      call = <T>(method: string, body: unknown) => callProxy<T>(fetchFn, proxyConfig, method, body, nowMs);
    } else {
      const token = await getAccessToken(keyConfig!, fetchFn, nowMs);
      call = <T>(method: string, body: unknown) => callDataApi<T>(fetchFn, token, propertyId, method, body);
    }
    const [main, byPage, byType] = await Promise.all([
      call<{ reports?: GaReport[] }>("batchRunReports", buildMainBatch(range)),
      call<GaReport>("runReport", buildEventsByPageRequest(range)),
      // 設置場所（content_type）は未登録だとエラーになるため、失敗してもイベント名だけの集計で続ける
      call<GaReport>("runReport", buildEventsByTypeRequest(range)).catch((err: unknown) => {
        if (err instanceof Ga4Error && err.kind === "api_error") return null;
        throw err;
      }),
    ]);
    const report = assembleReport(range, main, byPage, byType, new Date(nowMs).toISOString());
    await writeCache(env, cacheKey, report, range.key === "today" ? TODAY_CACHE_TTL_SECONDS : REPORT_CACHE_TTL_SECONDS, nowMs);
    return { ok: true, configured: true, cached: false, report };
  } catch (err) {
    // ログにはエラーの種類だけを出す（Googleのエラー本文・鍵・トークンは出さない）
    const kind = err instanceof Ga4Error ? err.kind : "api_error";
    console.error(JSON.stringify({ event: "ga4-analytics-error", kind }));
    return { ok: false, configured: true, error: "unavailable" };
  }
}
