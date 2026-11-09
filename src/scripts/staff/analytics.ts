// アクセス解析（ブラウザで動作）：/staff/api/analytics を読み込んで表示する。
// 値は textContent でのみ表示する（XSS対策）。数値はGA4から取得した実データだけで、未設定・取得失敗のときは表示しない。

import { apiErrorMessage, showNotice, staffApi } from "./api";
import type { AnalyticsApiResponse, AnalyticsBreakdownRow, AnalyticsDailyPoint, AnalyticsRangeKey, AnalyticsReport } from "../../types/analytics";
import { CSV_BOM, analyticsReportToCsv } from "../../utils/analyticsCsv";

const SVG_NS = "http://www.w3.org/2000/svg";
const CHART_COLOR = "#D9530B"; // brand-orange-dark（白背景とのコントラスト3:1以上）

const notice = document.querySelector<HTMLElement>("[data-staff-notice]");
const $ = <T extends Element = HTMLElement>(selector: string) => document.querySelector<T>(selector)!;
const numberText = (value: number) => value.toLocaleString("ja-JP");
const formatDateTime = (iso: string) =>
  new Date(iso).toLocaleString("ja-JP", { timeZone: "Asia/Tokyo", year: "numeric", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });
const formatDate = (date: string) => {
  const [y, m, d] = date.split("-").map(Number);
  return `${y}年${m}月${d}日`;
};
const shortDate = (date: string) => {
  const [, m, d] = date.split("-").map(Number);
  return `${m}/${d}`;
};

let currentRange: AnalyticsRangeKey = "7d";
let currentReport: AnalyticsReport | null = null;

function el<K extends keyof HTMLElementTagNameMap>(tag: K, text?: string, className?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  if (className) node.className = className;
  return node;
}

function svg<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number>): SVGElementTagNameMap[K] {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, String(value));
  return node;
}

type ViewState = "loading" | "setup" | "unavailable" | "content";
function showState(state: ViewState): void {
  $("[data-analytics-loading]").classList.toggle("hidden", state !== "loading");
  $("[data-analytics-setup]").classList.toggle("hidden", state !== "setup");
  $("[data-analytics-unavailable]").classList.toggle("hidden", state !== "unavailable");
  $("[data-analytics-content]").classList.toggle("hidden", state !== "content");
  if (state !== "content") currentReport = null;
}

function changeText(current: number, previous: number): string {
  if (!previous) return "前期間比：—（前期間のデータなし）";
  const percent = Math.round(((current - previous) / previous) * 1000) / 10;
  const sign = percent > 0 ? "+" : percent < 0 ? "−" : "±";
  return `前期間比：${sign}${Math.abs(percent).toFixed(1)}%（前期間 ${numberText(previous)}）`;
}

function renderSummary(report: AnalyticsReport): void {
  for (const key of ["pageViews", "users", "sessions"] as const) {
    const card = $(`[data-summary="${key}"]`);
    card.querySelector('[data-field="value"]')!.textContent = numberText(report.totals.current[key]);
    card.querySelector('[data-field="change"]')!.textContent = changeText(report.totals.current[key], report.totals.previous[key]);
  }
}

/** 日別の表示回数の折れ線（1系列なので凡例は付けず、見出しで示す）。数値は下の表でも確認できる */
function renderDailyChart(daily: AnalyticsDailyPoint[]): void {
  const container = $("[data-daily-chart]");
  // 表示幅に合わせて描く（縮小で文字が小さくならないように）
  const width = Math.max(280, Math.round(container.clientWidth || 640));
  const height = width < 480 ? 200 : 240;
  const pad = { top: 16, right: 12, bottom: 28, left: 44 };
  const max = Math.max(1, ...daily.map((d) => d.pageViews));
  // 目盛りの上限：1・2・5×10のべき乗の4等分で、最大値を少し上回るきりのよい値
  const niceMax = (() => {
    const raw = (max * 1.05) / 4;
    const base = 10 ** Math.floor(Math.log10(raw));
    const step = [1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10].map((m) => m * base).find((s) => s >= raw)!;
    return step * 4;
  })();
  const innerW = width - pad.left - pad.right;
  const innerH = height - pad.top - pad.bottom;
  const x = (i: number) => pad.left + (daily.length === 1 ? innerW / 2 : (innerW * i) / (daily.length - 1));
  const y = (v: number) => pad.top + innerH - (innerH * v) / niceMax;

  const total = daily.reduce((sum, d) => sum + d.pageViews, 0);
  const peak = daily.reduce((best, d) => (d.pageViews > best.pageViews ? d : best), daily[0]);
  const chart = svg("svg", { viewBox: `0 0 ${width} ${height}`, width, height, role: "img", class: "block max-w-full h-auto" });
  const title = svg("title", {});
  title.textContent = `日別の表示回数（${formatDate(daily[0].date)}〜${formatDate(daily[daily.length - 1].date)}、合計${numberText(total)}回、最多は${formatDate(peak.date)}の${numberText(peak.pageViews)}回）`;
  chart.append(title);

  // 目盛り（控えめな横線）
  for (let i = 0; i <= 4; i++) {
    const value = (niceMax * i) / 4;
    chart.append(svg("line", { x1: pad.left, x2: width - pad.right, y1: y(value), y2: y(value), stroke: "#e7e5e4", "stroke-width": 1 }));
    const label = svg("text", { x: pad.left - 6, y: y(value) + 4, "text-anchor": "end", "font-size": 11, fill: "#454545" });
    label.textContent = numberText(Math.round(value));
    chart.append(label);
  }
  // 日付の目盛り（多すぎないよう間引く）
  const every = Math.max(1, Math.ceil(daily.length / (width < 480 ? 4 : 7)));
  daily.forEach((d, i) => {
    if (i % every !== 0 && i !== daily.length - 1) return;
    if (i !== daily.length - 1 && daily.length - 1 - i < every / 2) return;
    const label = svg("text", { x: x(i), y: height - 8, "text-anchor": "middle", "font-size": 11, fill: "#454545" });
    label.textContent = shortDate(d.date);
    chart.append(label);
  });

  const points = daily.map((d, i) => `${x(i)},${y(d.pageViews)}`).join(" ");
  if (daily.length > 1) {
    chart.append(svg("polyline", { points, fill: "none", stroke: CHART_COLOR, "stroke-width": 2, "stroke-linejoin": "round", "stroke-linecap": "round" }));
  }
  // 各日の点（マウスを重ねると日付と数値が出る。当たり判定は点より大きくする）
  daily.forEach((d, i) => {
    const group = svg("g", {});
    const tip = svg("title", {});
    tip.textContent = `${formatDate(d.date)}：${numberText(d.pageViews)}回`;
    group.append(tip);
    if (daily.length <= 31) group.append(svg("circle", { cx: x(i), cy: y(d.pageViews), r: 4, fill: CHART_COLOR, stroke: "#ffffff", "stroke-width": 2 }));
    group.append(svg("circle", { cx: x(i), cy: y(d.pageViews), r: 12, fill: "transparent" }));
    chart.append(group);
  });
  container.replaceChildren(chart);

  $("[data-daily-table]").replaceChildren(
    ...daily.map((d) => {
      const row = el("tr", undefined, "border-b border-black/5 last:border-0");
      row.append(el("th", formatDate(d.date), "py-2 pr-3 text-left font-normal whitespace-nowrap"));
      for (const value of [d.pageViews, d.users, d.sessions]) row.append(el("td", numberText(value), "py-2 pl-3 text-right tabular-nums"));
      row.firstElementChild!.setAttribute("scope", "row");
      return row;
    }),
  );
}

/** 横棒の内訳（数値と割合を文字でも示す） */
function renderBars(target: string, rows: AnalyticsBreakdownRow[]): void {
  const total = rows.reduce((sum, r) => sum + r.value, 0);
  const max = Math.max(1, ...rows.map((r) => r.value));
  const list = el("ul", undefined, "space-y-3");
  for (const row of rows) {
    const item = el("li", undefined, "space-y-1");
    const line = el("div", undefined, "flex items-baseline justify-between gap-3 text-sm");
    line.append(el("span", row.label, "font-bold text-ink"));
    const share = total > 0 ? `${((row.value / total) * 100).toFixed(1)}%` : "—";
    line.append(el("span", `${numberText(row.value)}（${share}）`, "text-ink tabular-nums whitespace-nowrap"));
    const track = el("div", undefined, "h-2 rounded-full bg-brand-orange-light");
    track.setAttribute("aria-hidden", "true");
    const bar = el("div", undefined, "h-2 rounded-full bg-brand-orange-dark");
    bar.style.width = `${(row.value / max) * 100}%`;
    track.append(bar);
    item.append(line, track);
    list.append(item);
  }
  $(`[data-bars="${target}"]`).replaceChildren(list);
}

function renderTables(report: AnalyticsReport): void {
  $("[data-top-pages]").replaceChildren(
    ...report.topPages.map((page, index) => {
      const row = el("tr", undefined, "border-b border-black/5 last:border-0 align-top");
      row.append(el("td", String(index + 1), "py-2 pr-3 tabular-nums"));
      const cell = el("td", undefined, "py-2 pr-3 min-w-0");
      cell.append(el("span", page.path, "block font-bold text-ink [overflow-wrap:anywhere]"), el("span", page.group, "block text-xs text-ink-soft"));
      row.append(cell, el("td", numberText(page.pageViews), "py-2 pl-3 text-right tabular-nums"));
      return row;
    }),
  );
  if (report.topPages.length === 0) {
    const row = el("tr");
    const cell = el("td", "この期間のデータはありません。", "py-2 text-ink-soft");
    cell.colSpan = 3;
    row.append(cell);
    $("[data-top-pages]").replaceChildren(row);
  }

  $("[data-content-type-missing]").classList.toggle("hidden", report.contentTypeAvailable);
  $("[data-events-empty]").classList.toggle("hidden", report.events.length > 0);
  $("[data-events]").replaceChildren(
    ...report.events.map((event) => {
      const row = el("tr", undefined, "border-b border-black/5 last:border-0 align-top");
      const name = el("td", undefined, "py-2 pr-3");
      name.append(el("span", event.label, "block font-bold text-ink"), el("span", event.name, "block text-xs text-ink-soft [overflow-wrap:anywhere]"));
      const place = event.contentType ?? (report.contentTypeAvailable ? "指定なし" : "未設定");
      row.append(name, el("td", place, "py-2 pr-3 [overflow-wrap:anywhere]"), el("td", numberText(event.count), "py-2 pl-3 text-right tabular-nums"));
      return row;
    }),
  );

  // スマホでも横スクロールせずに読めるよう、ページごとのカードで表示する
  $("[data-transitions]").replaceChildren(
    ...report.transitions.map((t) => {
      const item = el("li", undefined, "rounded-xl bg-brand-orange-light/60 p-4 space-y-2 min-w-0");
      item.append(el("h3", t.label, "font-bold text-ink"), el("p", t.path, "text-xs text-ink-soft [overflow-wrap:anywhere]"));
      const list = el("dl", undefined, "grid grid-cols-[1fr_auto] gap-x-3 gap-y-1 text-sm");
      const pair = (term: string, value: string, strong = false) => {
        list.append(el("dt", term, "text-ink-soft"), el("dd", value, `text-right tabular-nums ${strong ? "text-lg font-bold text-ink" : "text-ink"}`));
      };
      pair("遷移率（参考）", t.rate === null ? "—" : `${t.rate.toFixed(1)}%`, true);
      pair("表示回数", numberText(t.pageViews));
      pair("ボタンのクリック数", numberText(t.clicks));
      pair("フォームの回答数", "未連携");
      item.append(list);
      return item;
    }),
  );
}

function render(report: AnalyticsReport): void {
  // 先に表示してから描く（グラフの幅を画面の幅から求めるため）
  showState("content");
  currentReport = report;
  $("[data-range-text]").textContent = `${formatDate(report.range.start)}〜${formatDate(report.range.end)}（${report.range.days}日間）`;
  $("[data-prev-text]").textContent = `${formatDate(report.range.prevStart)}〜${formatDate(report.range.prevEnd)}`;
  $("[data-fetched-at]").textContent = formatDateTime(report.fetchedAt);
  renderSummary(report);
  renderDailyChart(report.daily);
  renderBars("pageGroups", report.pageGroups);
  renderBars("channels", report.channels);
  renderBars("devices", report.devices);
  renderTables(report);
}

function setPressed(key: AnalyticsRangeKey): void {
  for (const button of document.querySelectorAll<HTMLButtonElement>("[data-range]")) {
    button.setAttribute("aria-pressed", String(button.dataset.range === key));
  }
  const form = $("[data-custom-range]");
  form.classList.toggle("hidden", key !== "custom");
  form.classList.toggle("flex", key === "custom");
}

async function load(query: string): Promise<void> {
  showState("loading");
  notice?.classList.add("hidden");
  const result = await staffApi<Record<string, unknown>>(`/staff/api/analytics?${query}`);
  const data = result.data as (AnalyticsApiResponse & { error?: string }) | null;
  if (data && "configured" in data && data.configured === false) {
    $("[data-setup-issue]").classList.toggle("hidden", data.issue !== "property_id_format");
    $("[data-range-text]").textContent = "—";
    $("[data-prev-text]").textContent = "—";
    $("[data-fetched-at]").textContent = "—";
    return showState("setup");
  }
  if (data && "report" in data && data.ok) return render(data.report);
  $("[data-fetched-at]").textContent = "未取得";
  if (data?.error === "unavailable") return showState("unavailable");
  showState("unavailable");
  if (data?.error === "invalid_range") return showNotice(notice, "期間の指定が正しくありません。開始日と終了日を確認してください。", "error");
  showNotice(notice, apiErrorMessage(result, "アクセス解析"), "error");
}

const todayJst = () => new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);

for (const button of document.querySelectorAll<HTMLButtonElement>("[data-range]")) {
  button.addEventListener("click", () => {
    const key = button.dataset.range as AnalyticsRangeKey;
    currentRange = key;
    setPressed(key);
    if (key === "custom") {
      const form = $<HTMLFormElement>("[data-custom-range]");
      const start = form.elements.namedItem("start") as HTMLInputElement;
      const end = form.elements.namedItem("end") as HTMLInputElement;
      end.max = start.max = todayJst();
      start.focus();
      return;
    }
    void load(`range=${key}`);
  });
}

$<HTMLFormElement>("[data-custom-range]").addEventListener("submit", (event) => {
  event.preventDefault();
  const form = event.currentTarget as HTMLFormElement;
  const start = (form.elements.namedItem("start") as HTMLInputElement).value;
  const end = (form.elements.namedItem("end") as HTMLInputElement).value;
  const error = $("[data-custom-error]");
  const message = !start || !end ? "開始日と終了日を入力してください。" : end < start ? "終了日は開始日と同じか、それより後の日付にしてください。" : end > todayJst() ? "終了日に未来の日付は指定できません。" : "";
  error.textContent = message;
  error.classList.toggle("hidden", !message);
  if (message) return;
  void load(new URLSearchParams({ range: "custom", start, end }).toString());
});

$("[data-analytics-retry]").addEventListener("click", () => {
  if (currentRange !== "custom") void load(`range=${currentRange}`);
  else $<HTMLFormElement>("[data-custom-range]").requestSubmit();
});

$("[data-analytics-csv]").addEventListener("click", () => {
  if (!currentReport) return;
  const blob = new Blob([CSV_BOM, analyticsReportToCsv(currentReport)], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `access-analytics_${currentReport.range.start}_${currentReport.range.end}.csv`;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
});

// 画面の幅が変わったら、グラフだけ描き直す
let resizeTimer: ReturnType<typeof setTimeout> | undefined;
window.addEventListener("resize", () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => {
    if (currentReport) renderDailyChart(currentReport.daily);
  }, 200);
});

setPressed(currentRange);
void load(`range=${currentRange}`);
