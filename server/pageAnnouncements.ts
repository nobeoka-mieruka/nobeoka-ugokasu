// 新しく公開されたページを検知し、「最新のお知らせ」の下書き（非公開）を作る仕組みです。
//
// 【考え方】
// ・「閲覧者に知らせるべき更新か」をコードの変更履歴から推測することはしない。
//   判断に使うのは「公開中のサイトマップに、これまで無かったURLが増えたか」だけ。
//   既存ページの文言・デザイン・SEO・内部コードの変更ではサイトマップは変わらないため、対象にならない。
//   noindexのページ・執行部ポータル・準備中のページは、もともとサイトマップに載らない（astro.config.mjs）。
// ・作るのは必ず「下書き（非公開）」。執行部ポータル（/staff/news/）で内容を確認してから公開する。
// ・お知らせは移行元キー "page:<パス>" で1ページにつき1件（news_items.source_key は一意）。重複して作られない。
// ・掲載日は、公開中のサイトで新しいページを確認した日（日本時間）。推測した日付は使わない。
// ・初回（記録が空のとき）は、今あるページを記録するだけで、お知らせは作らない。
// ・一度に増えたページが多すぎる場合（URLの整理など）は、下書きも作らず「要確認」として報告する。
//
// 呼び出し元：functions/api/admin/detect-new-pages.ts（GitHub Actions がデプロイ完了後に呼ぶ）

import type { NewsCategoryKey } from "../src/types/news";
import { nowSeconds } from "./auditLog";
import { createNewsItem, ensureNewsSchema, NEWS_LIMITS } from "./newsItems";

export const PUBLIC_PAGES_SCHEMA_SQL: readonly string[] = [
  `CREATE TABLE IF NOT EXISTS public_pages (
  path TEXT PRIMARY KEY,
  first_seen_on TEXT NOT NULL,
  first_seen_commit TEXT,
  created_at INTEGER NOT NULL
)`,
];

/** 一度に下書きを作るページ数の上限。これを超えたら下書きを作らず、要確認として報告する */
export const MAX_NEW_PAGES_PER_RUN = 10;

/** 下書きを作るときの作成者名（執行部ポータルの操作ログに残る） */
export const DETECT_ACTOR = "system:page-detect";

const SITE_NAME_SUFFIX = /\s*[｜|]\s*福富千恵と延岡を動かす会\s*$/;

let schemaReady = new WeakSet<D1Database>();

/** テスト用：スキーマ作成済みの記録を消す */
export function resetPublicPagesSchemaCache(): void {
  schemaReady = new WeakSet();
}

async function ensurePublicPagesSchema(db: D1Database): Promise<void> {
  if (schemaReady.has(db)) return;
  await db.batch(PUBLIC_PAGES_SCHEMA_SQL.map((sql) => db.prepare(sql)));
  schemaReady.add(db);
}

/** サイトマップ（XML）から、同じサイトのURLのパスだけを取り出す */
export function parseSitemapLocs(xml: string, origin: string): string[] {
  const paths: string[] = [];
  for (const match of xml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/g)) {
    let url: URL;
    try {
      url = new URL(match[1]);
    } catch {
      continue;
    }
    if (url.origin !== origin) continue;
    paths.push(url.pathname);
  }
  return paths;
}

/**
 * お知らせの対象にするページか。
 * トップページ・お知らせ記事（記事そのものがお知らせ）・執行部ポータル・API などは対象外。
 */
export function isAnnounceablePath(path: string): boolean {
  if (path === "/" || !path.startsWith("/")) return false;
  return !/^\/(news|staff|api)(\/|$)/.test(path) && !/^\/404/.test(path) && !/\.(xml|json|txt)$/.test(path);
}

/** パスからカテゴリーを決める（執行部ポータルで変更できる） */
export function categoryForPath(path: string): NewsCategoryKey {
  if (path.startsWith("/activities/")) return "activity_report";
  if (path.startsWith("/events/")) return "event";
  if (path.startsWith("/dialogue/")) return "dialogue";
  return "notice";
}

const decodeEntities = (text: string) =>
  text
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&#x27;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");

export interface PageMeta {
  title: string;
  description: string;
  noindex: boolean;
}

/** ページのHTMLから、タイトル・説明文・noindex指定を読み取る */
export function extractPageMeta(html: string): PageMeta {
  const rawTitle = /<title>([^<]*)<\/title>/i.exec(html)?.[1] ?? "";
  const rawDescription = /<meta\s+name="description"\s+content="([^"]*)"/i.exec(html)?.[1] ?? "";
  const robots = /<meta\s+name="robots"\s+content="([^"]*)"/i.exec(html)?.[1] ?? "";
  return {
    title: decodeEntities(rawTitle).replace(SITE_NAME_SUFFIX, "").trim(),
    description: decodeEntities(rawDescription).trim(),
    noindex: /noindex/i.test(robots),
  };
}

const truncate = (text: string, max: number) => (text.length <= max ? text : `${text.slice(0, max - 1)}…`);

/** 下書きのタイトル（例：「みんなの声ポスト」のページを公開しました） */
export function draftTitle(pageTitle: string): string {
  const suffix = "のページを公開しました";
  return `「${truncate(pageTitle, NEWS_LIMITS.title - suffix.length - 2)}」${suffix}`;
}

export interface DetectResult {
  /** 公開中のサイトのコミット（build-version.json の値） */
  liveCommit: string | null;
  status: "baseline" | "recorded" | "ok" | "too_many" | "not_live";
  /** サイトマップにあった対象ページ数 */
  pageCount: number;
  /** 下書きを作ったページ */
  drafted: { path: string; newsId: number; title: string }[];
  /** 確認が必要なページ（理由つき）。下書きは作っていない */
  needsReview: { path: string; reason: string }[];
}

export interface DetectOptions {
  /** 公開中のサイトから静的ファイルを取得する（Pagesでは env.ASSETS.fetch） */
  fetchAsset: (path: string) => Promise<Response>;
  /** 掲載日（日本時間の今日、YYYY-MM-DD） */
  today: string;
  /** 指定した場合、公開中のサイトがこのコミットでなければ何もしない */
  expectedCommit?: string | null;
  /**
   * true の場合、増えたページを記録するだけで下書きは作らない。
   * 「要確認」と報告されたページを確認し終えたあとに、手動実行で使う（URLの整理だった場合など）。
   */
  recordOnly?: boolean;
}

async function readText(fetchAsset: DetectOptions["fetchAsset"], path: string): Promise<string> {
  const res = await fetchAsset(path);
  if (!res.ok) throw new Error(`asset_unavailable:${path}:${res.status}`);
  return res.text();
}

/**
 * 公開中のサイトマップ（sitemap-index.xml とその中のサイトマップ）から、対象ページのパスを集める。
 * サイトマップのURLは常に本番のアドレスで書かれているため、サイトのアドレスはサイトマップ自身から決める
 *（プレビュー環境・ローカルのテスト環境で呼ばれても、同じように読めるようにするため）。
 */
async function liveSitemapPaths(options: DetectOptions): Promise<string[]> {
  const index = await readText(options.fetchAsset, "/sitemap-index.xml");
  const firstLoc = /<loc>\s*([^<\s]+)\s*<\/loc>/.exec(index)?.[1];
  let siteOrigin: string;
  try {
    siteOrigin = new URL(firstLoc ?? "").origin;
  } catch {
    throw new Error("sitemap_empty");
  }
  const sitemapPaths = parseSitemapLocs(index, siteOrigin).filter((path) => /^\/sitemap-[\w-]+\.xml$/.test(path));
  if (sitemapPaths.length === 0) throw new Error("sitemap_empty");
  const pages = new Set<string>();
  for (const sitemapPath of sitemapPaths) {
    for (const path of parseSitemapLocs(await readText(options.fetchAsset, sitemapPath), siteOrigin)) pages.add(path);
  }
  return [...pages].filter(isAnnounceablePath).sort();
}

/**
 * 新しく公開されたページを検知し、お知らせの下書きを作る。
 * 途中で読み込みに失敗した場合は例外を投げる（呼び出し元は何も記録しない。記録とお知らせ作成はページ単位で行う）。
 */
export async function detectNewPages(db: D1Database, options: DetectOptions): Promise<DetectResult> {
  let liveCommit: string | null = null;
  try {
    const version = JSON.parse(await readText(options.fetchAsset, "/build-version.json")) as { commitSha?: unknown };
    liveCommit = typeof version.commitSha === "string" ? version.commitSha : null;
  } catch {
    liveCommit = null;
  }
  const result: DetectResult = { liveCommit, status: "ok", pageCount: 0, drafted: [], needsReview: [] };
  if (options.expectedCommit && options.expectedCommit !== liveCommit) return { ...result, status: "not_live" };

  const paths = await liveSitemapPaths(options);
  result.pageCount = paths.length;

  await ensurePublicPagesSchema(db);
  await ensureNewsSchema(db);
  const known = new Set(((await db.prepare("SELECT path FROM public_pages").all<{ path: string }>()).results ?? []).map((row) => row.path));
  const record = (path: string) =>
    db
      .prepare("INSERT OR IGNORE INTO public_pages (path, first_seen_on, first_seen_commit, created_at) VALUES (?1, ?2, ?3, ?4)")
      .bind(path, options.today, liveCommit, nowSeconds());

  // 初回：今あるページを記録するだけ（既存ページのお知らせは作らない）
  const newPaths = paths.filter((path) => !known.has(path));
  if (known.size === 0 || options.recordOnly) {
    if (newPaths.length > 0) await db.batch(newPaths.map(record));
    return { ...result, status: known.size === 0 ? "baseline" : "recorded" };
  }

  if (newPaths.length === 0) return result;

  // 既存のお知らせ（D1・記事ファイル）が、すでにそのページへリンクしていれば下書きを作らない
  const linkedPaths = new Set(
    ((await db.prepare("SELECT link_url FROM news_items WHERE deleted_at IS NULL").all<{ link_url: string }>()).results ?? []).map((row) => row.link_url),
  );
  try {
    const fileItems = JSON.parse(await readText(options.fetchAsset, "/news/file-items.json")) as { items?: { href?: unknown }[] };
    for (const item of fileItems.items ?? []) if (typeof item.href === "string") linkedPaths.add(item.href);
  } catch {
    // 記事ファイルの一覧を読めない場合は、重複を確かめられないため下書きを作らない
    throw new Error("file_items_unavailable");
  }

  // 一度に多数増えた場合は、URLの整理などの可能性があるため自動では作らない（記録もしないので、次回も報告される）
  if (newPaths.length > MAX_NEW_PAGES_PER_RUN) {
    return {
      ...result,
      status: "too_many",
      needsReview: newPaths.map((path) => ({ path, reason: `一度に${newPaths.length}ページ増えたため、自動では下書きを作りませんでした` })),
    };
  }

  for (const path of newPaths) {
    let meta: PageMeta;
    try {
      meta = extractPageMeta(await readText(options.fetchAsset, path));
    } catch {
      result.needsReview.push({ path, reason: "ページを読み込めませんでした（次回もう一度確認します）" });
      continue;
    }
    if (meta.noindex) {
      // サイトマップとページの設定が食い違っている。公開ページとして扱わない
      result.needsReview.push({ path, reason: "検索除外（noindex）のページのため、お知らせにしませんでした" });
      await db.batch([record(path)]);
      continue;
    }
    if (linkedPaths.has(path)) {
      result.needsReview.push({ path, reason: "このページへのお知らせがすでにあるため、下書きを作りませんでした" });
      await db.batch([record(path)]);
      continue;
    }
    if (!meta.title) {
      result.needsReview.push({ path, reason: "ページのタイトルを読み取れませんでした（次回もう一度確認します）" });
      continue;
    }
    const title = draftTitle(meta.title);
    const summary = truncate(meta.description || `${meta.title}のページを公開しました。`, NEWS_LIMITS.summary);
    const created = await createNewsItem(
      db,
      { publishedOn: options.today, category: categoryForPath(path), title, summary, linkUrl: path, isPublished: false, displayOrder: 0 },
      DETECT_ACTOR,
      `page:${path}`,
    );
    await db.batch([record(path)]);
    // created が null ＝同じページのお知らせがすでにある（手動で作成済みなど）。重複は作らない
    if (created) result.drafted.push({ path, newsId: created.id, title });
  }
  return result;
}
