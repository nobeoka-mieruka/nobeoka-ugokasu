// トップページ「最新のお知らせ」と /news/ のお知らせカードのHTMLを組み立てます。
//
// ・ビルド時（src/pages/index.astro・src/pages/news/index.astro）と、配信時（functions/index.ts・
//   functions/news/index.ts がD1の内容で差し替え）の両方で同じ関数を使い、デザインを1か所で管理します。
//   見た目は従来の NewsCard.astro と同じです。
// ・値はすべて escapeHtml を通してから埋め込みます（XSS対策）。外部リンクは別タブで開き rel="noopener noreferrer" を付けます。
// ・Functionsからも読み込むため、実行環境に依存するファイル（siteConfig.ts 等）を import しないでください。

import type { NewsDisplayItem } from "../types/news";
import { escapeHtml } from "./html";

/** トップページに表示する件数 */
export const HOME_NEWS_LIMIT = 3;

const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const SNS_HOSTS = /(^|\.)(facebook\.com|instagram\.com|threads\.net|threads\.com|x\.com|twitter\.com|youtube\.com|youtu\.be)$/i;

const EXTERNAL_ICON =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="w-4 h-4" aria-hidden="true"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>';
const documentIcon = (className: string) =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="${className}" aria-hidden="true"><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><polyline points="14 3 14 8 19 8"/><line x1="8" y1="13" x2="16" y2="13"/><line x1="8" y1="17" x2="16" y2="17"/></svg>`;

export const isExternalHref = (href: string) => /^https?:\/\//i.test(href);

/** "2026-09-07" → "2026年9月7日" */
export function formatNewsDate(date: string): string {
  const match = DATE_PATTERN.exec(date);
  if (!match) return date;
  return `${Number(match[1])}年${Number(match[2])}月${Number(match[3])}日`;
}

/** 表示順：表示順の値（小さいほど先）→ 掲載日の新しい順。同じ場合は元の並び（D1の新しい登録が先）を保つ */
export function sortNews(items: NewsDisplayItem[]): NewsDisplayItem[] {
  return [...items].sort((a, b) => a.displayOrder - b.displayOrder || b.date.localeCompare(a.date));
}

/**
 * D1のお知らせと、ファイル由来のお知らせ（記事・SNS投稿の昇格など）をまとめる。
 * ・掲載日が今日より後のものは表示しない（予約掲載）
 * ・D1へ移行済み（同じ移行元キーがD1にある）ファイル由来のお知らせは表示しない
 * ・SNS投稿の昇格分は、同じリンク先のお知らせがD1にあれば表示しない
 */
export function mergeNews(
  d1: { items: NewsDisplayItem[]; sourceKeys: Set<string>; linkUrls: Set<string> },
  fileItems: NewsDisplayItem[],
  today: string,
): NewsDisplayItem[] {
  const fromFiles = fileItems.filter(
    (item) =>
      DATE_PATTERN.test(item.date) &&
      item.date <= today &&
      !d1.sourceKeys.has(item.key) &&
      !(item.key.startsWith("social:") && d1.linkUrls.has(item.href)),
  );
  return sortNews([...d1.items.filter((item) => item.date <= today), ...fromFiles]);
}

function cardHtml(item: NewsDisplayItem): string {
  const header = `<div class="flex flex-wrap items-center gap-2 text-sm text-ink-soft">
    <span class="rounded-full bg-brand-orange-light px-2.5 py-1 font-bold text-ink">${escapeHtml(item.category)}</span>
    <time datetime="${escapeHtml(item.date)}T00:00:00.000Z">${escapeHtml(formatNewsDate(item.date))}</time>
  </div>
  <h3 class="text-xl font-bold text-ink leading-snug [overflow-wrap:anywhere]">${escapeHtml(item.title)}</h3>
  <p class="text-base text-ink-soft [overflow-wrap:anywhere]">${escapeHtml(item.summary)}</p>`;
  if (!item.href) return `<div class="card flex flex-col gap-3 h-full" data-news-item>\n  ${header}\n</div>`;
  const external = isExternalHref(item.href);
  let label = "詳しく見る";
  if (external) {
    try {
      if (SNS_HOSTS.test(new URL(item.href).hostname)) label = "投稿を見る";
    } catch {
      // URLとして読めない値は登録時に拒否しているため、ここには来ない
    }
  }
  return `<a href="${escapeHtml(item.href)}" class="card flex flex-col gap-3 h-full hover:shadow-md transition-shadow" data-news-item${
    external ? ' target="_blank" rel="noopener noreferrer"' : ""
  }>
  ${header}${
    external
      ? `\n  <span class="mt-auto inline-flex items-center gap-1 pt-1 text-sm font-bold text-brand-orange-dark">${label}${EXTERNAL_ICON}<span class="sr-only">（新しいタブで開く）</span></span>`
      : ""
  }
</a>`;
}

/** トップページ「最新のお知らせ」の中身（最新3件＋一覧へのボタン、または0件の案内） */
export function renderHomeNews(items: NewsDisplayItem[]): string {
  const latest = items.slice(0, HOME_NEWS_LIMIT);
  if (latest.length === 0) {
    return `<div class="rounded-xl bg-white ring-1 ring-black/5 px-5 py-4 flex items-center gap-3 text-ink-soft">
  ${documentIcon("w-5 h-5 text-brand-orange flex-shrink-0")}
  <p>新しいお知らせは、公開次第こちらに掲載します。</p>
</div>`;
  }
  return `<div class="grid gap-4 sm:grid-cols-3">
${latest.map(cardHtml).join("\n")}
</div>
<div class="mt-8 text-center">
  <a href="/news/" class="btn-secondary">お知らせ一覧を見る</a>
</div>`;
}

/** /news/ の一覧の中身 */
export function renderNewsList(items: NewsDisplayItem[]): string {
  if (items.length === 0) {
    return `<div class="card text-center py-16 text-ink-soft flex flex-col items-center gap-3">
  ${documentIcon("w-10 h-10 text-brand-orange")}
  <p class="text-lg">新しいお知らせは、公開次第こちらに掲載します。</p>
</div>`;
  }
  return `<div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
${items.map(cardHtml).join("\n")}
</div>`;
}
