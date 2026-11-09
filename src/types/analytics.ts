// 執行部ポータル「アクセス解析」（/staff/analytics/）で、サーバー（server/ga4Analytics.ts）と
// 画面（src/scripts/staff/analytics.ts）が共有するデータの形です。値はGA4 Data APIから取得した実データだけで、
// 見本の数値・推定値は入りません。

export type AnalyticsRangeKey = "today" | "7d" | "30d" | "90d" | "custom";

export interface AnalyticsRange {
  key: AnalyticsRangeKey;
  /** 集計期間（日本時間の日付 YYYY-MM-DD。両端を含む） */
  start: string;
  end: string;
  /** 日数 */
  days: number;
  /** 比較に使う直前の同じ長さの期間 */
  prevStart: string;
  prevEnd: string;
}

export interface AnalyticsTotals {
  pageViews: number;
  users: number;
  sessions: number;
}

export interface AnalyticsDailyPoint extends AnalyticsTotals {
  date: string;
}

export interface AnalyticsBreakdownRow {
  key: string;
  label: string;
  value: number;
}

export interface AnalyticsTopPage {
  path: string;
  group: string;
  pageViews: number;
}

export interface AnalyticsEventRow {
  name: string;
  label: string;
  /** 設置場所（GA4のカスタムディメンション content_type）。未登録・未設定のときは null */
  contentType: string | null;
  count: number;
}

export interface AnalyticsTransitionRow {
  path: string;
  label: string;
  events: string[];
  pageViews: number;
  clicks: number;
  /** ボタンのクリック数 ÷ ページの表示回数 × 100（参考指標）。表示回数が0のときは null */
  rate: number | null;
}

export interface AnalyticsReport {
  range: AnalyticsRange;
  /** GA4からデータを取得した日時（ISO 8601） */
  fetchedAt: string;
  totals: { current: AnalyticsTotals; previous: AnalyticsTotals };
  daily: AnalyticsDailyPoint[];
  pageGroups: AnalyticsBreakdownRow[];
  topPages: AnalyticsTopPage[];
  channels: AnalyticsBreakdownRow[];
  devices: AnalyticsBreakdownRow[];
  events: AnalyticsEventRow[];
  /** content_type（設置場所）の内訳を取得できたか（GA4でカスタムディメンションが未登録だと false） */
  contentTypeAvailable: boolean;
  transitions: AnalyticsTransitionRow[];
  /** Googleフォームの回答数は連携していないため、常に "unlinked"（数値は出さない） */
  formResponses: "unlinked";
}

/** GET /staff/api/analytics の応答 */
export type AnalyticsApiResponse =
  | { ok: true; configured: false; issue: "missing" | "property_id_format" | "proxy_config" }
  | { ok: true; configured: true; cached: boolean; report: AnalyticsReport }
  | { ok: false; configured: true; error: "unavailable" }
  | { ok: false; error: "invalid_range" };
