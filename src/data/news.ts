// =============================================================
// お知らせ（新着情報）のうち、ファイルで管理しているものを集約するファイルです。
//
// 【現在の管理方法】
// 「最新のお知らせ」は、執行部ポータル（/staff/news/）から登録・編集します（Cloudflare D1 の news_items）。
// トップページと /news/ は、配信時にD1のお知らせと、このファイルが返すお知らせをまとめて表示します
//（functions/index.ts・functions/news/index.ts、HTMLは src/utils/newsCards.ts）。
//
// このファイルが扱うのは次の3つです。
//   A. 下の newsEntries（短いお知らせ）           … 現在は0件（2026-10 にD1へ移行済み）
//   B. src/content/news/*.md（本文のある記事）      … 個別ページ /news/<slug>/ が作られます
//   C. SNS投稿の昇格（src/data/socialNewsPromotions.ts）
//
// 二重表示の防止：D1へ移行したお知らせには、移行元キー（"news:<id>"・"article:<slug>"）が付いています。
// D1に同じキーがある場合、ファイル側のお知らせは表示されません（D1側で削除・非公開にした場合も同様）。
// 記事（B）を新しく追加した場合は、D1に無いため自動的に一覧へ表示されます。
//
// -------------------------------------------------------------
// 【入力ルール】
// ・確認できていない内容・日付は登録しないでください（推測での入力は禁止です）。
// ・date は必ず "YYYY-MM-DD" 形式。未来の日付はその日が来るまで自動的に非表示になります。
// =============================================================

import { getCollection, type CollectionEntry } from "astro:content";
import { promotedSocialNews } from "./socialNewsPromotions";
import type { NewsDisplayItem } from "../types/news";
import { todayInJapan } from "../utils/dialogueEvents";

/** お知らせの分類（src/content/config.ts の news コレクションと同じ選択肢） */
export type NewsCategory =
  | "お知らせ"
  | "活動予定"
  | "意見交換会"
  | "活動報告"
  | "後援会"
  | "サイト更新";

export interface NewsEntry {
  /** 他のお知らせと重複しない識別子 */
  id: string;
  /** 掲載日（"YYYY-MM-DD"形式） */
  date: string;
  /** 見出し */
  title: string;
  /** 内容の要約（カードに表示されます） */
  summary: string;
  /** 分類 */
  category: NewsCategory;
  /**
   * 関連ページへのリンク（省略可）。
   * サイト内のパス（"/activities/"）でも、SNS投稿の公開URLでも構いません。
   * 外部URLの場合は自動的に別タブで開き、rel="noopener noreferrer" が付与されます。
   */
  href?: string;
}

/**
 * お知らせの登録一覧。
 * 実際に行った更新・活動だけを追加してください（架空のお知らせは登録しないでください）。
 */
export const newsEntries: NewsEntry[] = [
  // 2026-10：ここにあった3件（ホームページを更新しました・新たに看板を設置しました・看板を設置しました）は、
  // 内容をそのままD1（news_items）へ移行しました（server/newsItems.ts の MIGRATED_NEWS）。
  // 以後の追加・編集は執行部ポータル（/staff/news/）から行ってください。
];

/** トップページ・一覧ページで共通して使う、表示用に整えたお知らせ1件分 */
export interface UnifiedNews {
  id: string;
  /**
   * 取得元を表すキー。"article:<slug>"（記事）・"news:<id>"（このファイル）・"social:<投稿ID>"（SNS投稿の昇格）。
   * D1（執行部ポータルのお知らせ）へ移行済みのものは、同じキーで二重表示を防ぎます。
   */
  sourceKey: string;
  date: Date;
  title: string;
  summary: string;
  category: string;
  /** サイト内の記事ページ、または関連ページ・SNS投稿へのリンク。無い場合は undefined */
  href?: string;
  /** 外部サイトへのリンクかどうか（別タブで開くかの判定に使用） */
  external: boolean;
}

function parseDate(value: string): Date | null {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function isExternal(href: string | undefined): boolean {
  return typeof href === "string" && /^https?:\/\//.test(href);
}

function fromCollection(entry: CollectionEntry<"news">): UnifiedNews {
  return {
    id: entry.slug,
    sourceKey: `article:${entry.slug}`,
    date: entry.data.date,
    title: entry.data.title,
    summary: entry.data.summary,
    category: entry.data.category,
    href: `/news/${entry.slug}/`,
    external: false,
  };
}

/**
 * お知らせの唯一の集約窓口。
 * ・記事コレクション（src/content/news/）
 * ・このファイルの newsEntries
 * ・お知らせへ昇格したSNS投稿（src/data/socialNewsPromotions.ts）
 * をまとめ、公開日の新しい順に返します。
 *
 * トップページと /news/ は必ずこの関数だけを呼び出してください
 *（ページごとに個別の配列を持たせると、表示内容がずれる原因になります）。
 */
export async function getUnifiedNews(now: number = Date.now()): Promise<UnifiedNews[]> {
  const collectionNews = (await getCollection("news", ({ data }) => data.published))
    .filter((entry) => entry.data.date.getTime() <= now)
    .map(fromCollection);

  const manualNews: UnifiedNews[] = newsEntries
    .map((entry): UnifiedNews | null => {
      const date = parseDate(entry.date);
      if (date === null || date.getTime() > now) return null;
      return {
        id: entry.id,
        sourceKey: `news:${entry.id}`,
        date,
        title: entry.title,
        summary: entry.summary,
        category: entry.category,
        href: entry.href,
        external: isExternal(entry.href),
      };
    })
    .filter((entry): entry is UnifiedNews => entry !== null);

  // 同じリンク先を指すお知らせは1件にまとめる（SNS投稿の昇格分と手動登録の重複防止）
  const knownHrefs = new Set(
    [...collectionNews, ...manualNews].map((entry) => entry.href).filter((href): href is string => Boolean(href)),
  );
  const promotedNews = promotedSocialNews(now).filter((entry) => !knownHrefs.has(entry.href ?? ""));

  return [...collectionNews, ...manualNews, ...promotedNews].sort(
    (a, b) => b.date.getTime() - a.date.getTime(),
  );
}

/** この一覧の中で最も新しいお知らせの日付を返す。0件の場合は null */
export function getNewsLastUpdated(entries: UnifiedNews[]): string | null {
  if (entries.length === 0) return null;
  return entries[0].date.toISOString();
}

/**
 * ファイル由来のお知らせを、公開ページの表示用の共通形（D1のお知らせと同じ形）へ変換して返す。
 * ビルド時に /news/file-items.json として出力し、配信時に functions がD1のお知らせとまとめる。
 */
export async function getFileNewsItems(now: number = Date.now()): Promise<NewsDisplayItem[]> {
  return (await getUnifiedNews(now)).map((entry) => ({
    key: entry.sourceKey,
    date: todayInJapan(entry.date),
    title: entry.title,
    summary: entry.summary,
    category: entry.category,
    href: entry.href ?? "",
    displayOrder: 0,
  }));
}
