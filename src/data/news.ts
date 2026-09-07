// =============================================================
// お知らせ（新着情報）を一元管理するファイルです。
//
// このファイルに1件追加するだけで、
//   ・トップページの「最新のお知らせ」（最新3件）
//   ・お知らせ一覧ページ（/news/）
// の両方へ自動的に反映されます（新しい日付順に並び替えられます）。
//
// -------------------------------------------------------------
// 【お知らせの2つの管理方法】
//
//   A. このファイル（src/data/news.ts）          … 短いお知らせ向け（かんたん・推奨）
//   B. src/content/news/*.md                     … 本文のある記事向け（個別ページが作られます）
//
// AとBは自動的に統合され、日付の新しい順に並びます。
// 既存のBの記事（公式サイト公開・みんなの声募集開始など）はそのまま動作します。
//
// -------------------------------------------------------------
// 【新しいお知らせを追加する手順】
// 1. 下の newsEntries 配列に、次の形でオブジェクトを1件追加する
// 2. npm run build が通ることを確認する
//
// 記入例：
// {
//   id: "2026-09-07-site-update",
//   date: "2026-09-07",
//   title: "ホームページを更新しました",
//   summary: "活動報告の表示、SNSの自動反映、お問い合わせ先の整理を行いました。",
//   category: "サイト更新",
//   href: "/activities/",            // 省略可。関連ページ・SNS投稿へのリンク
// },
//
// -------------------------------------------------------------
// 【入力ルール】
// ・確認できていない内容・日付は登録しないでください（推測での入力は禁止です）。
// ・SNSへ投稿した内容をお知らせにする場合は、実際の投稿と食い違わないようにしてください。
// ・date は必ず "YYYY-MM-DD" 形式。未来の日付はその日が来るまで自動的に非表示になります。
// ・同じ内容が src/content/news/ にすでにある場合は、重複して登録しないでください。
// =============================================================

import { getCollection, type CollectionEntry } from "astro:content";
import { promotedSocialNews } from "./socialNewsPromotions";

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
  {
    id: "2026-09-07-site-update",
    date: "2026-09-07",
    title: "ホームページを更新しました",
    summary:
      "活動報告の表示、SNS投稿の自動反映、お問い合わせ先の整理、サイト内情報の見直しを行いました。最新の活動は活動報告ページからご覧いただけます。",
    category: "サイト更新",
    href: "/activities/",
  },
  {
    // Facebook投稿（2026-08-25）に基づくお知らせ。内容は投稿と一致させています。
    id: "2026-08-25-signboards-added",
    date: "2026-08-25",
    title: "新たに看板を設置しました",
    summary:
      "新たに2か所へ看板を設置しました。設置場所をご提供いただいた皆さま、ご協力いただいた皆さまに御礼申し上げます。地域の皆さまに活動を知っていただけるよう、今後も情報発信を続けていきます。",
    category: "活動報告",
    href: "https://www.facebook.com/122103979557398900/posts/122118395127398900",
  },
  {
    // Facebook投稿（2026-08-15）に基づくお知らせ。内容は投稿と一致させています。
    id: "2026-08-15-signboard-installed",
    date: "2026-08-15",
    title: "看板を設置しました",
    summary:
      "地域の皆さまに活動を知っていただくため、市内各所に看板を設置しました。設置にご協力いただいた皆さま、ありがとうございます。",
    category: "活動報告",
    href: "https://www.facebook.com/122103979557398900/posts/122115573039398900",
  },
];

/** トップページ・一覧ページで共通して使う、表示用に整えたお知らせ1件分 */
export interface UnifiedNews {
  id: string;
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
