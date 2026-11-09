// 執行部ポータル（/staff/analytics/）が中継へ送るのと同じ要求の本文を作ります（診断用。portal-check.mjs から使う）。
// 本物は server/ga4Analytics.ts の buildMainBatch・buildEventsByPageRequest・buildEventsByTypeRequest です。
// 両者が一致していることは scripts/tests/ga4-proxy.test.ts で確認しています（どちらかを変えたらテストが失敗します）。

/** server/ga4Analytics.ts の TRACKED_EVENTS と同じイベント名（同じ順番） */
export const PORTAL_TRACKED_EVENTS = [
  "welfare_apply_click",
  "dialogue_apply_click",
  "voices_form_click",
  "voice_form_click",
  "voice_post_click",
  "supporter_join_click",
  "voices_entry_click",
  "news_detail_click",
  "activity_read_more",
  "supporter_rules_open",
  "facebook_click",
  "instagram_click",
  "contact_click",
];

const addDays = (date, days) => {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
};

/** ポータルと同じ期間（日本時間。過去7日・30日・90日は昨日まで、today は今日だけ）と、その直前の同じ日数 */
export function portalRange(key, now = new Date()) {
  const today = new Date(now.getTime() + 9 * 3600_000).toISOString().slice(0, 10);
  const days = { today: 1, "7d": 7, "30d": 30, "90d": 90 }[key];
  if (!days) return null;
  const end = key === "today" ? today : addDays(today, -1);
  const start = addDays(end, -(days - 1));
  const prevEnd = addDays(start, -1);
  return { key, start, end, days, prevStart: addDays(prevEnd, -(days - 1)), prevEnd };
}

const dateRange = (start, end, name) => ({ startDate: start, endDate: end, ...(name ? { name } : {}) });
const eventFilter = () => ({ filter: { fieldName: "eventName", inListFilter: { values: [...PORTAL_TRACKED_EVENTS] } } });

/** ポータルが同時に送る3つの要求（label：説明、method：GA4 のメソッド、body：本文、optional：失敗してもポータルは表示できるか） */
export function portalRequests(range) {
  const current = [dateRange(range.start, range.end)];
  const totalsMetrics = [{ name: "screenPageViews" }, { name: "totalUsers" }, { name: "sessions" }];
  return [
    {
      label: "合計・日別・ページ・流入元・端末（batchRunReports）",
      method: "batchRunReports",
      optional: false,
      body: {
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
      },
    },
    {
      label: "ボタンのクリック × ページ（runReport）",
      method: "runReport",
      optional: false,
      body: { dateRanges: current, dimensions: [{ name: "eventName" }, { name: "pagePath" }], metrics: [{ name: "eventCount" }], dimensionFilter: eventFilter(), limit: 1000 },
    },
    {
      label: "ボタンのクリック × 設置場所 content_type（runReport・未登録なら失敗してよい）",
      method: "runReport",
      optional: true,
      body: {
        dateRanges: current,
        dimensions: [{ name: "eventName" }, { name: "customEvent:content_type" }],
        metrics: [{ name: "eventCount" }],
        dimensionFilter: eventFilter(),
        limit: 1000,
      },
    },
  ];
}
