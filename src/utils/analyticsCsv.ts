// アクセス解析（/staff/analytics/）のCSV出力です。ブラウザで作り、Excelで文字化けしないよう UTF-8（BOM付き）で保存します。
// 値はGA4から取得した実データだけです。

import type { AnalyticsReport } from "../types/analytics";

/**
 * CSVの1つの値を整える。カンマ・引用符・改行を含む値は "…" で囲み、" は "" にする。
 * 表計算ソフトで数式として実行されないよう、= + - @ などで始まる文字列の先頭には ' を付ける（数値はそのまま）。
 */
export function csvCell(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "";
  let text = value;
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[",\r\n]/.test(text) || text !== text.trim() ? `"${text.replace(/"/g, '""')}"` : text;
}

export function toCsv(rows: readonly (readonly (string | number | null | undefined)[])[]): string {
  return rows.map((row) => row.map(csvCell).join(",")).join("\r\n") + "\r\n";
}

/** Excelで開けるよう先頭にBOMを付ける */
export const CSV_BOM = "﻿";

const rateText = (rate: number | null) => (rate === null ? "—" : rate);

/** 画面に表示している内容を1つのCSVにまとめる（見出し行で区切る） */
export function analyticsReportToCsv(report: AnalyticsReport): string {
  const { range, totals } = report;
  const rows: (string | number | null)[][] = [
    ["アクセス解析", `${range.start}〜${range.end}`],
    ["比較期間", `${range.prevStart}〜${range.prevEnd}`],
    ["データ更新日時", report.fetchedAt],
    [],
    ["合計", "今回", "前期間"],
    ["表示回数", totals.current.pageViews, totals.previous.pageViews],
    ["ユーザー数", totals.current.users, totals.previous.users],
    ["訪問数（セッション）", totals.current.sessions, totals.previous.sessions],
    [],
    ["日付", "表示回数", "ユーザー数", "訪問数"],
    ...report.daily.map((d) => [d.date, d.pageViews, d.users, d.sessions]),
    [],
    ["ページのまとまり", "表示回数"],
    ...report.pageGroups.map((g) => [g.label, g.value]),
    [],
    ["ページ", "まとまり", "表示回数"],
    ...report.topPages.map((p) => [p.path, p.group, p.pageViews]),
    [],
    ["流入元", "訪問数"],
    ...report.channels.map((c) => [c.label, c.value]),
    [],
    ["端末", "訪問数"],
    ...report.devices.map((d) => [d.label, d.value]),
    [],
    ["ボタン", "イベント名", "設置場所", "クリック数"],
    ...report.events.map((e) => [e.label, e.name, e.contentType ?? (report.contentTypeAvailable ? "指定なし" : "未設定"), e.count]),
    [],
    ["申込への遷移（参考指標。申込完了率ではありません）", "ページ", "表示回数", "ボタンのクリック数", "遷移率（%）", "Googleフォームの回答数"],
    ...report.transitions.map((t) => [t.label, t.path, t.pageViews, t.clicks, rateText(t.rate), "未連携"]),
  ];
  return toCsv(rows);
}
