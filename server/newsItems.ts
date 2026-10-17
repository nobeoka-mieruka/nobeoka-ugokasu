// 「最新のお知らせ」（D1: news_items）の保存・読み出し・入力値検証です。
//
// ・テーブルは最初のアクセス時に CREATE TABLE IF NOT EXISTS で作成する（既存テーブルには触れない）。
//   同じ内容を migrations/0003_news_items.sql にも置いている（テストで一致を確認）。
// ・既存のお知らせ6件（src/data/news.ts の3件と、src/content/news/ の記事3件）を、移行元キー（source_key）付きで
//   INSERT OR IGNORE により1回だけ登録する。管理画面で編集・削除した後に再実行しても、上書き・復活はしない。
// ・公開ページでは、D1にある移行元キーと同じファイル由来のお知らせを表示しない（二重表示の防止）。
// ・削除は論理削除。追加・編集・公開状態の変更・削除は staff_audit_log に記録する。

import {
  NEWS_CATEGORIES,
  NEWS_CATEGORY_LABELS,
  SELECTABLE_NEWS_CATEGORIES,
  type NewsCategoryKey,
  type NewsDisplayItem,
  type NewsItemRecord,
} from "../src/types/news";
import { AUDIT_SCHEMA_SQL, auditLastInsertStatement, auditStatement, logStaffChange, nowSeconds } from "./auditLog";
import { boolValue, FORBIDDEN_CHARS, integerValue, isValidDate, textField } from "./validation";

/** 既存のお知らせ（移行元）。内容は移行前のファイルと同一 */
const MIGRATED_NEWS = [
  {
    sourceKey: "article:2026-07-16-voices-collection-started",
    publishedOn: "2026-07-16",
    category: "notice",
    title: "「みんなの声」の募集を開始しました",
    summary:
      "延岡市で暮らす中で感じている困りごとや、地域をより良くするためのご意見を募集しています。いただいた声は個人が特定されない形で整理し、今後の活動や提言に活用します。",
    linkUrl: "/news/2026-07-16-voices-collection-started/",
  },
  {
    sourceKey: "article:2026-07-17-official-site-launch",
    publishedOn: "2026-07-17",
    category: "site_update",
    title: "公式ホームページを公開しました",
    summary: "「福富千恵と延岡を動かす会」の公式ホームページを公開しました。活動報告や政策、皆さまからのご意見などを発信していきます。",
    linkUrl: "/news/2026-07-17-official-site-launch/",
  },
  {
    sourceKey: "article:2026-07-17-city-guide-diagnosis",
    publishedOn: "2026-07-17",
    category: "site_update",
    title: "「延岡市役所 どこに行けばいい？診断」を公開しました",
    summary:
      "質問に答えることで、相談内容に合った延岡市役所の窓口を確認できる案内ページを公開しました。本ページは市民の利便性向上を目的として独自に作成した非公式の案内です。",
    linkUrl: "/news/2026-07-17-city-guide-diagnosis/",
  },
  {
    sourceKey: "news:2026-08-15-signboard-installed",
    publishedOn: "2026-08-15",
    category: "activity_report",
    title: "看板を設置しました",
    summary: "地域の皆さまに活動を知っていただくため、市内各所に看板を設置しました。設置にご協力いただいた皆さま、ありがとうございます。",
    linkUrl: "https://www.facebook.com/122103979557398900/posts/122115573039398900",
  },
  {
    sourceKey: "news:2026-08-25-signboards-added",
    publishedOn: "2026-08-25",
    category: "activity_report",
    title: "新たに看板を設置しました",
    summary:
      "新たに2か所へ看板を設置しました。設置場所をご提供いただいた皆さま、ご協力いただいた皆さまに御礼申し上げます。地域の皆さまに活動を知っていただけるよう、今後も情報発信を続けていきます。",
    linkUrl: "https://www.facebook.com/122103979557398900/posts/122118395127398900",
  },
  {
    sourceKey: "news:2026-09-07-site-update",
    publishedOn: "2026-09-07",
    category: "site_update",
    title: "ホームページを更新しました",
    summary:
      "活動報告の表示、SNS投稿の自動反映、お問い合わせ先の整理、サイト内情報の見直しを行いました。最新の活動は活動報告ページからご覧いただけます。",
    linkUrl: "/activities/",
  },
] as const satisfies readonly { sourceKey: string; publishedOn: string; category: NewsCategoryKey; title: string; summary: string; linkUrl: string }[];

const sqlString = (value: string) => `'${value.replace(/'/g, "''")}'`;

export const NEWS_SCHEMA_SQL: readonly string[] = [
  `CREATE TABLE IF NOT EXISTS news_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source_key TEXT UNIQUE,
  published_on TEXT NOT NULL,
  category TEXT NOT NULL CHECK (category IN ('activity_report', 'dialogue', 'event', 'notice', 'site_update')),
  title TEXT NOT NULL,
  summary TEXT NOT NULL DEFAULT '',
  link_url TEXT NOT NULL DEFAULT '',
  is_published INTEGER NOT NULL DEFAULT 1 CHECK (is_published IN (0, 1)),
  display_order INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  created_by TEXT NOT NULL,
  updated_by TEXT NOT NULL,
  deleted_at INTEGER,
  deleted_by TEXT
)`,
  "CREATE INDEX IF NOT EXISTS news_items_listing ON news_items (deleted_at, is_published, published_on)",
  ...AUDIT_SCHEMA_SQL,
  ...MIGRATED_NEWS.map(
    (item) => `INSERT OR IGNORE INTO news_items (source_key, published_on, category, title, summary, link_url, is_published, display_order, created_at, updated_at, created_by, updated_by)
VALUES (${[item.sourceKey, item.publishedOn, item.category, item.title, item.summary, item.linkUrl].map(sqlString).join(", ")}, 1, 0, CAST(strftime('%s', 'now') AS INTEGER), CAST(strftime('%s', 'now') AS INTEGER), 'system:migration', 'system:migration')`,
  ),
];

let schemaReady = new WeakSet<D1Database>();

/** テスト用：スキーマ作成済みの記録を消す */
export function resetNewsSchemaCache(): void {
  schemaReady = new WeakSet();
}

async function ensureNewsSchema(db: D1Database): Promise<void> {
  if (schemaReady.has(db)) return;
  await db.batch(NEWS_SCHEMA_SQL.map((sql) => db.prepare(sql)));
  schemaReady.add(db);
}

// ---- 入力値検証 ----

export const NEWS_LIMITS = { title: 100, summary: 300, linkUrl: 500, displayOrderAbs: 9999 } as const;

export interface NewsItemInput {
  publishedOn: string;
  category: NewsCategoryKey;
  title: string;
  summary: string;
  linkUrl: string;
  isPublished: boolean;
  displayOrder: number;
}

export type NewsFieldErrors = Partial<Record<keyof NewsItemInput, string>>;
export type NewsValidationResult<T> = { ok: true; value: T } | { ok: false; errors: NewsFieldErrors };

/** サイト内のパスとして安全な文字だけ（空白・引用符・山かっこ・バックスラッシュは不可） */
const INTERNAL_PATH = /^\/(?!\/)[A-Za-z0-9\-._~/%?#=&+:@!$,;*()]*$/;

/** リンク先を検証する。サイト内のパス（/〜）か、http(s) のURLだけを許可する（javascript: 等は拒否） */
export function validateLinkUrl(value: string): string | null {
  if (value === "") return "";
  if (value.length > NEWS_LIMITS.linkUrl || FORBIDDEN_CHARS.test(value) || /\s/.test(value)) return null;
  if (value.startsWith("/")) return INTERNAL_PATH.test(value) ? value : null;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if ((url.protocol !== "https:" && url.protocol !== "http:") || !url.hostname || url.username || url.password) return null;
  return url.href;
}

/** 外部サイトへのリンクか */
export const isExternalLink = (href: string) => /^https?:\/\//i.test(href);

/**
 * 新規登録・編集の入力値を検証する（サーバー側で必ず実行する）。
 * currentCategory … 編集中のお知らせの現在のカテゴリー。「サイト更新」は既存データのまま保存する場合に限り認める。
 */
export function validateNewsInput(raw: unknown, currentCategory?: NewsCategoryKey): NewsValidationResult<NewsItemInput> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { ok: false, errors: { title: "入力内容を読み取れませんでした。" } };
  const body = raw as Record<string, unknown>;
  const errors: NewsFieldErrors = {};

  const title = textField(body, "title", "タイトル", { required: true, max: NEWS_LIMITS.title }, errors);
  const summary = textField(body, "summary", "概要", { required: true, max: NEWS_LIMITS.summary }, errors);

  const publishedOn = typeof body.publishedOn === "string" ? body.publishedOn.trim() : "";
  if (!isValidDate(publishedOn)) errors.publishedOn = "掲載日を正しく入力してください（例：2026-10-17）。";

  const category = body.category;
  const allowed: readonly string[] = currentCategory === "site_update" ? [...SELECTABLE_NEWS_CATEGORIES, "site_update"] : SELECTABLE_NEWS_CATEGORIES;
  if (typeof category !== "string" || !allowed.includes(category)) errors.category = "カテゴリーを選択してください。";

  const rawLink = typeof body.linkUrl === "string" ? body.linkUrl.trim() : body.linkUrl === undefined || body.linkUrl === null ? "" : null;
  const linkUrl = rawLink === null ? null : validateLinkUrl(rawLink);
  if (linkUrl === null) {
    errors.linkUrl = "リンク先は「/」で始まるサイト内のページか、「https://」で始まるURLを入力してください（不要な場合は空欄）。";
  }

  const isPublished = body.isPublished === undefined ? true : boolValue(body.isPublished);
  if (isPublished === null) errors.isPublished = "公開状態の形式が正しくありません。";

  const displayOrder = integerValue(body.displayOrder);
  if (displayOrder === "invalid" || (displayOrder !== null && Math.abs(displayOrder) > NEWS_LIMITS.displayOrderAbs)) {
    errors.displayOrder = `表示順は-${NEWS_LIMITS.displayOrderAbs}〜${NEWS_LIMITS.displayOrderAbs}の整数で入力してください。`;
  }

  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return {
    ok: true,
    value: {
      publishedOn,
      category: category as NewsCategoryKey,
      title,
      summary,
      linkUrl: linkUrl as string,
      isPublished: isPublished as boolean,
      displayOrder: (displayOrder as number | null) ?? 0,
    },
  };
}

/** 公開／非公開の切り替え（一覧画面からの PATCH）の入力値を検証する */
export function validatePublishChange(raw: unknown): NewsValidationResult<{ isPublished: boolean }> {
  const body = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const isPublished = typeof body.isPublished === "boolean" ? body.isPublished : null;
  if (isPublished === null) return { ok: false, errors: { isPublished: "公開状態を指定してください。" } };
  return { ok: true, value: { isPublished } };
}

// ---- 読み出し ----

interface NewsRow {
  id: number;
  source_key: string | null;
  published_on: string;
  category: NewsCategoryKey;
  title: string;
  summary: string;
  link_url: string;
  is_published: number;
  display_order: number;
  created_at: number;
  updated_at: number;
  created_by: string;
  updated_by: string;
}

const ADMIN_COLUMNS =
  "id, source_key, published_on, category, title, summary, link_url, is_published, display_order, created_at, updated_at, created_by, updated_by";
const ORDER_BY = "ORDER BY display_order ASC, published_on DESC, id DESC";
const LIST_LIMIT = 500;

function toRecord(row: NewsRow): NewsItemRecord {
  return {
    id: row.id,
    sourceKey: row.source_key,
    publishedOn: row.published_on,
    category: row.category,
    title: row.title,
    summary: row.summary,
    linkUrl: row.link_url,
    isPublished: row.is_published === 1,
    displayOrder: row.display_order,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    createdBy: row.created_by,
    updatedBy: row.updated_by,
  };
}

/** 公開ページ用のお知らせと、二重表示を防ぐための情報 */
export interface PublicNews {
  items: NewsDisplayItem[];
  /** D1にある移行元キー（削除・非公開を含む）。同じキーのファイル由来のお知らせは表示しない */
  sourceKeys: Set<string>;
  /** D1のお知らせのリンク先（削除・非公開を含む）。同じリンク先のSNS投稿の昇格分は表示しない */
  linkUrls: Set<string>;
}

/** 公開ページ用：公開中・掲載日を過ぎたお知らせ（作成者などの管理用項目は読み出さない） */
export async function listPublicNews(db: D1Database, today: string): Promise<PublicNews> {
  await ensureNewsSchema(db);
  const [published, keys] = await db.batch<{
    id: number;
    published_on: string;
    category: NewsCategoryKey;
    title: string;
    summary: string;
    link_url: string;
    display_order: number;
    source_key: string | null;
  }>([
    db
      .prepare(
        `SELECT id, published_on, category, title, summary, link_url, display_order FROM news_items
         WHERE deleted_at IS NULL AND is_published = 1 AND published_on <= ?1 ${ORDER_BY} LIMIT ${LIST_LIMIT}`,
      )
      .bind(today),
    db.prepare("SELECT source_key, link_url FROM news_items"),
  ]);
  return {
    items: (published.results ?? []).map((row) => ({
      key: `d1:${row.id}`,
      date: row.published_on,
      title: row.title,
      summary: row.summary,
      category: NEWS_CATEGORY_LABELS[row.category] ?? "お知らせ",
      href: row.link_url,
      displayOrder: row.display_order,
    })),
    sourceKeys: new Set((keys.results ?? []).map((row) => row.source_key).filter((key): key is string => Boolean(key))),
    linkUrls: new Set((keys.results ?? []).map((row) => row.link_url).filter(Boolean)),
  };
}

export async function listNewsItems(db: D1Database): Promise<NewsItemRecord[]> {
  await ensureNewsSchema(db);
  const { results } = await db.prepare(`SELECT ${ADMIN_COLUMNS} FROM news_items WHERE deleted_at IS NULL ${ORDER_BY} LIMIT ${LIST_LIMIT}`).all<NewsRow>();
  return results.map(toRecord);
}

export async function getNewsItem(db: D1Database, id: number): Promise<NewsItemRecord | null> {
  await ensureNewsSchema(db);
  const row = await db.prepare(`SELECT ${ADMIN_COLUMNS} FROM news_items WHERE id = ?1 AND deleted_at IS NULL`).bind(id).first<NewsRow>();
  return row ? toRecord(row) : null;
}

// ---- 書き込み（すべて操作ログと同じトランザクションで記録する） ----

export type NewsAction = "news.create" | "news.update" | "news.publish" | "news.delete";
const AUDIT_TARGET = "news_item";
const logAction = (action: NewsAction, id: number, detail: Record<string, unknown>) => logStaffChange("staff-news-change", action, id, detail);

const INPUT_COLUMNS: Record<keyof NewsItemInput, string> = {
  publishedOn: "published_on",
  category: "category",
  title: "title",
  summary: "summary",
  linkUrl: "link_url",
  isPublished: "is_published",
  displayOrder: "display_order",
};

const columnValues = (input: NewsItemInput): unknown[] => [
  input.publishedOn,
  input.category,
  input.title,
  input.summary,
  input.linkUrl,
  input.isPublished ? 1 : 0,
  input.displayOrder,
];

/** 新規登録。sourceKey を指定した場合、同じキーのお知らせがすでにあれば登録せず null を返す（重複防止） */
export async function createNewsItem(db: D1Database, input: NewsItemInput, actor: string, sourceKey: string | null = null): Promise<NewsItemRecord | null> {
  await ensureNewsSchema(db);
  const now = nowSeconds();
  const columns = Object.values(INPUT_COLUMNS);
  const detail = { category: input.category, isPublished: input.isPublished, ...(sourceKey ? { sourceKey } : {}) };
  if (sourceKey && (await db.prepare("SELECT id FROM news_items WHERE source_key = ?1").bind(sourceKey).first())) return null;
  const [inserted] = await db.batch<NewsRow>([
    db
      .prepare(
        `INSERT INTO news_items (${columns.join(", ")}, source_key, created_at, updated_at, created_by, updated_by)
         VALUES (${columns.map((_, i) => `?${i + 1}`).join(", ")}, ?8, ?9, ?9, ?10, ?10)
         RETURNING ${ADMIN_COLUMNS}`,
      )
      .bind(...columnValues(input), sourceKey, now, actor),
    auditLastInsertStatement(db, "news.create", AUDIT_TARGET, actor, detail, now),
  ]);
  const row = inserted?.results?.[0];
  if (!row) throw new Error("news_insert_failed");
  logAction("news.create", row.id, detail);
  return toRecord(row);
}

/** 編集。対象が無い（削除済みを含む）場合は null */
export async function updateNewsItem(db: D1Database, id: number, input: NewsItemInput, actor: string): Promise<NewsItemRecord | null> {
  const before = await getNewsItem(db, id);
  if (!before) return null;
  const now = nowSeconds();
  const changed = (Object.keys(INPUT_COLUMNS) as (keyof NewsItemInput)[]).filter((key) => before[key] !== input[key]);
  const assignments = Object.values(INPUT_COLUMNS).map((column, i) => `${column} = ?${i + 1}`);
  const detail = { changed };
  await db.batch([
    db
      .prepare(`UPDATE news_items SET ${assignments.join(", ")}, updated_at = ?8, updated_by = ?9 WHERE id = ?10 AND deleted_at IS NULL`)
      .bind(...columnValues(input), now, actor, id),
    auditStatement(db, "news.update", AUDIT_TARGET, id, actor, detail, now),
  ]);
  logAction("news.update", id, detail);
  return getNewsItem(db, id);
}

/** 公開／非公開の切り替え。対象が無い場合は null */
export async function setNewsPublished(db: D1Database, id: number, isPublished: boolean, actor: string): Promise<NewsItemRecord | null> {
  const before = await getNewsItem(db, id);
  if (!before) return null;
  const now = nowSeconds();
  const detail = { from: before.isPublished, to: isPublished };
  await db.batch([
    db.prepare("UPDATE news_items SET is_published = ?1, updated_at = ?2, updated_by = ?3 WHERE id = ?4 AND deleted_at IS NULL").bind(isPublished ? 1 : 0, now, actor, id),
    auditStatement(db, "news.publish", AUDIT_TARGET, id, actor, detail, now),
  ]);
  logAction("news.publish", id, detail);
  return getNewsItem(db, id);
}

/** 削除（論理削除）。対象が無い場合は false */
export async function deleteNewsItem(db: D1Database, id: number, actor: string): Promise<boolean> {
  const before = await getNewsItem(db, id);
  if (!before) return false;
  const now = nowSeconds();
  await db.batch([
    db.prepare("UPDATE news_items SET deleted_at = ?1, deleted_by = ?2, updated_at = ?1, updated_by = ?2 WHERE id = ?3 AND deleted_at IS NULL").bind(now, actor, id),
    auditStatement(db, "news.delete", AUDIT_TARGET, id, actor, {}, now),
  ]);
  logAction("news.delete", id, {});
  return true;
}

