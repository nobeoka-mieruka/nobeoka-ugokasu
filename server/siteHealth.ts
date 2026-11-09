// サイトの状態（執行部ポータル /staff/status/）のサーバー側処理です。
//
// 2つの情報源をまとめて「正常・要確認・失敗」で表示します。
//  1. 定期チェック（.github/workflows/site-monitor.yml → POST /api/admin/site-health）の結果
//     … 本番デプロイの反映、自動処理（GitHub Actions）の失敗、RSSとお知らせ一覧の一致。
//       D1の site_health_checks に、チェックごとの最新状態を保存する。
//       状態が変わったとき、または異常が続いているときだけ書き込み、異常になったときは staff_audit_log にも記録する。
//  2. 表示のたびに読む情報 … 公開中のビルド（/build-version.json）、お知らせの更新日時・確認待ち件数（D1）、
//     SNS取得の記録（KV。Meta APIは呼ばない）。
//
// 秘密キー・アクセストークン・SNS側のエラー文は保存も表示もしない。

import { auditStatement, AUDIT_SCHEMA_SQL, nowSeconds } from "./auditLog";
import type { AssetsEnv, SocialSyncEnv } from "./env";
import { readSnsStatus } from "./snsAdmin";
import { ensureNewsSchema } from "./newsItems";

export type HealthState = "ok" | "warning" | "error";

/** 定期チェックから受け付けるチェックの種類 */
export const MONITOR_CHECKS = ["deploy", "site_update", "rss", "sns_build", "dialogue_form"] as const;
export type MonitorCheckKey = (typeof MONITOR_CHECKS)[number];

/** 定期チェックがこれより長く動いていなければ「要確認」（定期チェックは1時間ごと） */
export const MONITOR_STALE_SECONDS = 3 * 60 * 60;
/** SNSの定期取得（約3分ごと）がこれより長く動いていなければ「要確認」 */
export const SNS_SYNC_STALE_SECONDS = 15 * 60;
export const MONITOR_ACTOR = "system:site-monitor";
const MONITOR_RUN_KEY = "monitor";
const SUMMARY_MAX = 300;

export const SITE_HEALTH_SCHEMA_SQL: readonly string[] = [
  `CREATE TABLE IF NOT EXISTS site_health_checks (
  check_key TEXT PRIMARY KEY,
  status TEXT NOT NULL,
  summary TEXT NOT NULL,
  since INTEGER NOT NULL,
  checked_at INTEGER NOT NULL
)`,
  ...AUDIT_SCHEMA_SQL,
];

let schemaReady = new WeakSet<D1Database>();

/** テスト用：スキーマ作成済みの記録を消す */
export function resetSiteHealthSchemaCache(): void {
  schemaReady = new WeakSet();
}

async function ensureSchema(db: D1Database): Promise<void> {
  if (schemaReady.has(db)) return;
  await db.batch(SITE_HEALTH_SCHEMA_SQL.map((sql) => db.prepare(sql)));
  schemaReady.add(db);
}

interface CheckRow {
  check_key: string;
  status: HealthState;
  summary: string;
  since: number;
  checked_at: number;
}

export interface MonitorCheckInput {
  key: MonitorCheckKey;
  status: HealthState;
  summary: string;
}

/** 受け取った内容を検証する（決まった種類・状態だけ。文は短くし、制御文字を除く）。不正なら null */
export function parseMonitorChecks(body: unknown): MonitorCheckInput[] | null {
  if (!body || typeof body !== "object" || !Array.isArray((body as { checks?: unknown }).checks)) return null;
  const checks = (body as { checks: unknown[] }).checks;
  const result: MonitorCheckInput[] = [];
  const seen = new Set<string>();
  for (const raw of checks) {
    if (!raw || typeof raw !== "object") return null;
    const { key, status, summary } = raw as Record<string, unknown>;
    if (typeof key !== "string" || !(MONITOR_CHECKS as readonly string[]).includes(key) || seen.has(key)) return null;
    if (status !== "ok" && status !== "warning" && status !== "error") return null;
    if (typeof summary !== "string") return null;
    seen.add(key);
    result.push({
      key: key as MonitorCheckKey,
      status,
      summary: summary.replace(/[\u0000-\u001F\u007F]/g, " ").trim().slice(0, SUMMARY_MAX),
    });
  }
  return result.length > 0 ? result : null;
}

export interface RecordResult {
  /** 書き込んだチェック（状態が変わった・異常が続いている） */
  written: MonitorCheckKey[];
  /** 新たに異常になり、操作ログへ記録したチェック */
  alerted: MonitorCheckKey[];
}

/**
 * 定期チェックの結果を保存する。
 * ・正常のまま変わらないチェックは書き込まない（定期チェックの実行日時だけを更新する）
 * ・状態が変わったら since（その状態になった日時）を更新する
 * ・正常から異常（要確認・失敗）になったときだけ staff_audit_log に記録する（毎回は記録しない）
 */
export async function recordMonitorChecks(db: D1Database, checks: MonitorCheckInput[], now = nowSeconds()): Promise<RecordResult> {
  await ensureSchema(db);
  const existing = new Map<string, CheckRow>();
  const rows = await db.prepare("SELECT check_key, status, summary, since, checked_at FROM site_health_checks").all<CheckRow>();
  for (const row of rows.results ?? []) existing.set(row.check_key, row);

  const statements: D1PreparedStatement[] = [];
  const written: MonitorCheckKey[] = [];
  const alerted: MonitorCheckKey[] = [];
  for (const check of checks) {
    const before = existing.get(check.key);
    const changed = !before || before.status !== check.status;
    if (!changed && check.status === "ok") continue;
    const since = changed ? now : before.since;
    statements.push(
      db
        .prepare(
          `INSERT INTO site_health_checks (check_key, status, summary, since, checked_at) VALUES (?1, ?2, ?3, ?4, ?5)
           ON CONFLICT(check_key) DO UPDATE SET status = excluded.status, summary = excluded.summary, since = excluded.since, checked_at = excluded.checked_at`,
        )
        .bind(check.key, check.status, check.summary, since, now),
    );
    written.push(check.key);
    if (check.status !== "ok" && (before?.status ?? "ok") === "ok") {
      statements.push(auditStatement(db, "site.health", "site_health", check.key, MONITOR_ACTOR, { status: check.status, summary: check.summary }, now));
      alerted.push(check.key);
    }
  }
  // 定期チェックが動いていることの記録
  statements.push(
    db
      .prepare(
        `INSERT INTO site_health_checks (check_key, status, summary, since, checked_at) VALUES (?1, 'ok', '', ?2, ?2)
         ON CONFLICT(check_key) DO UPDATE SET checked_at = excluded.checked_at`,
      )
      .bind(MONITOR_RUN_KEY, now),
  );
  await db.batch(statements);
  return { written, alerted };
}

// ---- ポータルに表示する状態 ----

export interface HealthItem {
  key: string;
  label: string;
  state: HealthState;
  /** 状態の説明（画面にそのまま表示する） */
  summary: string;
  /** 関係する日時（ISO 8601）。無い場合は null */
  at: string | null;
}

export interface SiteStatus {
  items: HealthItem[];
  counts: Record<HealthState, number>;
  generatedAt: string;
}

export type SiteStatusEnv = AssetsEnv & Partial<SocialSyncEnv> & { STAFF_DB: D1Database };

const iso = (seconds: number | null | undefined) => (seconds ? new Date(seconds * 1000).toISOString() : null);

const ERROR_KIND_TEXT: Record<string, string> = {
  token_expired: "トークンの更新が必要",
  permission_denied: "権限の確認が必要",
  rate_limited: "一時的な制限",
  api_error: "取得エラー",
  network_error: "通信エラー",
};
const PLATFORM_LABEL: Record<string, string> = { facebook: "Facebook", instagram: "Instagram", threads: "Threads" };

async function readLiveBuild(env: SiteStatusEnv, origin: string): Promise<{ commitSha: string | null; builtAt: string | null } | null> {
  try {
    const res = await env.ASSETS.fetch(new URL("/build-version.json", origin));
    if (!res.ok) return null;
    const body = (await res.json()) as { commitSha?: unknown; builtAt?: unknown };
    return { commitSha: typeof body.commitSha === "string" ? body.commitSha : null, builtAt: typeof body.builtAt === "string" ? body.builtAt : null };
  } catch {
    return null;
  }
}

/** 公開中のビルドがどのSNSデータから作られたか（scripts/sync-social-posts.mjs が出力する /social-build-manifest.json） */
async function readSnsBuildManifest(env: SiteStatusEnv, origin: string): Promise<{ generatedAt: string | null; count: number | null } | null> {
  try {
    const res = await env.ASSETS.fetch(new URL("/social-build-manifest.json", origin));
    if (!res.ok) return null;
    const body = (await res.json()) as { generatedAt?: unknown; count?: unknown };
    return { generatedAt: typeof body.generatedAt === "string" ? body.generatedAt : null, count: typeof body.count === "number" ? body.count : null };
  } catch {
    return null;
  }
}

async function readLatestFileNewsDate(env: SiteStatusEnv, origin: string): Promise<string | null> {
  try {
    const res = await env.ASSETS.fetch(new URL("/news/file-items.json", origin));
    if (!res.ok) return null;
    const body = (await res.json()) as { items?: { date?: unknown; key?: unknown }[] };
    const dates = (body.items ?? []).filter((i) => typeof i.key === "string" && i.key.startsWith("article:")).map((i) => i.date).filter((d): d is string => typeof d === "string");
    return dates.length ? dates.sort().at(-1)! : null;
  } catch {
    return null;
  }
}

export async function readSiteStatus(env: SiteStatusEnv, origin: string, now = nowSeconds()): Promise<SiteStatus> {
  const db = env.STAFF_DB;
  await ensureSchema(db);
  await ensureNewsSchema(db);
  const [checkRows, newsRow, pendingRow, liveBuild, latestArticleDate, sns, snsBuild] = await Promise.all([
    db.prepare("SELECT check_key, status, summary, since, checked_at FROM site_health_checks").all<CheckRow>(),
    db.prepare("SELECT MAX(updated_at) AS updated_at FROM news_items WHERE deleted_at IS NULL").first<{ updated_at: number | null }>(),
    db
      .prepare("SELECT COUNT(*) AS n FROM news_items WHERE deleted_at IS NULL AND is_published = 0 AND source_key LIKE 'page:%'")
      .first<{ n: number }>(),
    readLiveBuild(env, origin),
    readLatestFileNewsDate(env, origin),
    env.SOCIAL_POSTS_KV ? readSnsStatus(env as SocialSyncEnv, db).catch(() => null) : Promise.resolve(null),
    readSnsBuildManifest(env, origin),
  ]);
  const checks = new Map((checkRows.results ?? []).map((row) => [row.check_key, row]));
  const monitorRun = checks.get(MONITOR_RUN_KEY);
  const monitorStale = !monitorRun || now - monitorRun.checked_at > MONITOR_STALE_SECONDS;

  const fromMonitor = (key: MonitorCheckKey, label: string): HealthItem => {
    const row = checks.get(key);
    if (!row) return { key, label, state: "warning", summary: "定期チェックの記録がまだありません。", at: null };
    const sinceText = row.status === "ok" ? "" : `（${new Date(row.since * 1000).toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" })} から）`;
    return { key, label, state: row.status, summary: `${row.summary || "問題ありません。"}${sinceText}`, at: iso(monitorRun?.checked_at ?? row.checked_at) };
  };

  const items: HealthItem[] = [];
  items.push(fromMonitor("deploy", "本番デプロイ状態"));
  items.push(
    liveBuild?.builtAt
      ? { key: "live_build", label: "最終正常デプロイ（公開中のビルド）", state: "ok", summary: `公開中のコミット：${(liveBuild.commitSha ?? "不明").slice(0, 7)}`, at: liveBuild.builtAt }
      : { key: "live_build", label: "最終正常デプロイ（公開中のビルド）", state: "warning", summary: "公開中のビルド情報（/build-version.json）を読めませんでした。", at: null },
  );
  const newsUpdatedAt = iso(newsRow?.updated_at ?? null);
  items.push({
    key: "news_updated",
    label: "最新のお知らせ更新",
    state: "ok",
    summary: `執行部ポータルでの最終更新：${newsUpdatedAt ? "右の日時" : "記録なし"}／記事ファイルの最新掲載日：${latestArticleDate ?? "不明"}`,
    at: newsUpdatedAt,
  });

  const facebook = sns?.platforms.find((p) => p.platform === "facebook");
  if (!sns || !facebook) {
    items.push({ key: "facebook_success", label: "Facebookの最終取得成功", state: "warning", summary: "SNS取得の記録を読めませんでした。", at: null });
  } else if (facebook.state === "not_configured") {
    items.push({ key: "facebook_success", label: "Facebookの最終取得成功", state: "warning", summary: "Facebookの連携が設定されていません。", at: null });
  } else {
    const lastSuccess = facebook.lastSuccessAt ?? sns.lastSuccessAt;
    items.push({
      key: "facebook_success",
      label: "Facebookの最終取得成功",
      state: facebook.state === "ok" ? "ok" : facebook.state === "error" ? "error" : "warning",
      summary: facebook.state === "ok" ? "正常に取得できています。" : facebook.state === "error" ? "取得に失敗しています（下の「SNS取得エラー」を参照）。" : "まだ同期の記録がありません。",
      at: lastSuccess,
    });
  }
  items.push({
    key: "facebook_latest_post",
    label: "最新のFacebook投稿",
    state: "ok",
    summary: facebook?.latestPostAt ? "保存済みの投稿のうち最も新しい投稿の日時です。" : "保存済みのFacebook投稿はありません。",
    at: facebook?.latestPostAt ?? null,
  });

  // 「最終同期」「最新投稿」「最終ビルド」は別々の日時として表示する
  //   最終同期   … SNSの定期取得（約3分ごと）を最後に実行した日時。閲覧者の画面（実行時API）はこの内容で最新になる
  //   最終ビルド … 公開中のHTML（検索エンジンが読む内容）に含まれるSNS投稿を取り込んだ日時
  const lastSync = sns?.lastCheckedAt ?? null;
  const syncAgeSeconds = lastSync ? now - Math.floor(Date.parse(lastSync) / 1000) : null;
  items.push({
    key: "sns_last_sync",
    label: "SNSの最終同期",
    state: syncAgeSeconds !== null && syncAgeSeconds <= SNS_SYNC_STALE_SECONDS ? "ok" : "warning",
    summary:
      syncAgeSeconds === null
        ? "SNSの定期取得の記録がありません。"
        : syncAgeSeconds <= SNS_SYNC_STALE_SECONDS
          ? "約3分ごとの定期取得を最後に実行した日時です（取得の成否は「SNS取得エラー」を参照）。"
          : "SNSの定期取得が15分以上実行されていません。定期実行Worker（nobeoka-ugokasu-social-cron）を確認してください。",
    at: lastSync,
  });
  items.push(
    snsBuild?.generatedAt
      ? {
          key: "sns_build_time",
          label: "SNSを反映した最終ビルド",
          state: "ok",
          summary: `公開中のHTML（検索エンジン向け）に含まれるSNS投稿（${snsBuild.count ?? "?"}件）を取り込んだ日時です。`,
          at: snsBuild.generatedAt,
        }
      : { key: "sns_build_time", label: "SNSを反映した最終ビルド", state: "warning", summary: "公開中のビルドのSNS情報（/social-build-manifest.json）を読めませんでした。", at: null },
  );
  items.push(fromMonitor("sns_build", "SNSの公開中HTML（検索エンジン向け）"));

  const failing = (sns?.platforms ?? []).filter((p) => p.state === "error");
  items.push({
    key: "sns_errors",
    label: "SNS取得エラー",
    state: !sns ? "warning" : failing.length ? "error" : "ok",
    summary: !sns
      ? "SNS取得の記録を読めませんでした。"
      : failing.length
        ? failing.map((p) => `${PLATFORM_LABEL[p.platform]}：${ERROR_KIND_TEXT[p.errorKind ?? "api_error"]}`).join("／") +
          (failing.some((p) => p.errorKind === "token_expired") ? "。SNS管理（/staff/sns/）の案内に沿ってトークンを更新してください。" : "。SNS管理（/staff/sns/）で詳細を確認してください。")
        : "エラーはありません。",
    at: failing[0]?.failingSince ?? sns?.lastCheckedAt ?? null,
  });

  const pending = pendingRow?.n ?? 0;
  items.push({
    key: "pending_news",
    label: "確認待ちのお知らせ",
    state: pending > 0 ? "warning" : "ok",
    summary: pending > 0 ? `${pending}件あります。お知らせ管理（/staff/news/）で内容を確認し、公開してください。` : "ありません。",
    at: null,
  });
  items.push(fromMonitor("site_update", "サイト更新（自動処理）"));
  items.push(fromMonitor("rss", "RSS・お知らせ一覧の一致"));
  items.push(fromMonitor("dialogue_form", "意見交換会の申込フォーム"));
  items.push({
    key: "monitor",
    label: "定期チェック",
    state: monitorStale ? "warning" : "ok",
    summary: monitorStale ? "定期チェック（GitHub Actions「Site monitor」）が3時間以上動いていません。" : "1時間ごとに動いています。",
    at: iso(monitorRun?.checked_at ?? null),
  });

  const counts: Record<HealthState, number> = { ok: 0, warning: 0, error: 0 };
  for (const item of items) counts[item.state]++;
  return { items, counts, generatedAt: new Date(now * 1000).toISOString() };
}
