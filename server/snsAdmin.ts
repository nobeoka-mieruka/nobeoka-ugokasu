// 執行部ポータルの「SNS管理」（/staff/sns/）のサーバー側処理です。
//
// ・状態表示：SNS自動同期がKV（SOCIAL_POSTS_KV）に保存している実行状況・投稿キャッシュを読むだけ（Meta APIは呼ばない）。
// ・今すぐ同期：既存の同期処理 runSocialSync（定期実行・/api/admin/sync-social-posts と同じ関数）をサーバー側で直接呼ぶ。
//   SOCIAL_SYNC_SECRET・SOCIAL_CRON_SECRET・META_ACCESS_TOKEN などはブラウザにも応答にも一切出さない。
// ・連打防止：手動同期は全体で60秒に1回まで（D1の staff_rate_limits で判定。D1は書き込みがすぐ反映されるため、同時に押されても1回だけ通る）。
// ・応答・画面には、成功／失敗・取得件数・同期日時だけを返す。エラーの詳細はサーバーログ（social-sync）でのみ確認する。
// ・手動同期の実行と結果は staff_audit_log に記録する（秘密情報は記録しない）。

import type { PlatformSyncStatus, SocialPlatform } from "../src/types/social";
import { auditStatement, AUDIT_SCHEMA_SQL, nowSeconds } from "./auditLog";
import type { SocialSyncEnv } from "./env";
import { readCache, readHeartbeat } from "./kv";
import { runSocialSync, summarizeForLog } from "./socialSync";

export const SNS_PLATFORMS = ["facebook", "instagram", "threads"] as const;
export type SnsPlatform = (typeof SNS_PLATFORMS)[number];

/** 手動同期の間隔（秒） */
export const MANUAL_SYNC_COOLDOWN_SECONDS = 60;
const RATE_LIMIT_KEY = "sns-manual-sync";

export const SNS_ADMIN_SCHEMA_SQL: readonly string[] = [
  `CREATE TABLE IF NOT EXISTS staff_rate_limits (
  key TEXT PRIMARY KEY,
  locked_until INTEGER NOT NULL
)`,
  ...AUDIT_SCHEMA_SQL,
];

let schemaReady = new WeakSet<D1Database>();

/** テスト用：スキーマ作成済みの記録を消す */
export function resetSnsAdminSchemaCache(): void {
  schemaReady = new WeakSet();
}

async function ensureSchema(db: D1Database): Promise<void> {
  if (schemaReady.has(db)) return;
  await db.batch(SNS_ADMIN_SCHEMA_SQL.map((sql) => db.prepare(sql)));
  schemaReady.add(db);
}

/**
 * 各SNSの連携に必要な設定がそろっているか（値そのものは返さず、有無だけ）。
 * server/socialSync.ts の runSocialSync が取得を試みる条件と同じ（テストで一致を確認）。
 */
export function configuredPlatforms(env: Partial<SocialSyncEnv>): Record<SnsPlatform, boolean> {
  return {
    facebook: Boolean(env.FACEBOOK_PAGE_ID && env.META_ACCESS_TOKEN),
    instagram: Boolean(env.INSTAGRAM_USER_ID && env.META_ACCESS_TOKEN),
    threads: Boolean(env.THREADS_USER_ID && env.THREADS_ACCESS_TOKEN),
  };
}

/** 画面に出す状態：設定が無ければ「未設定」。設定があっても同期の記録が無ければ「未同期」 */
export type SnsDisplayState = "ok" | "error" | "not_configured" | "not_synced";

function displayState(configured: boolean, status: PlatformSyncStatus | undefined): SnsDisplayState {
  if (!configured) return "not_configured";
  if (status === "ok") return "ok";
  if (status === "error") return "error";
  return "not_synced";
}

export interface SnsPlatformStatus {
  platform: SnsPlatform;
  state: SnsDisplayState;
  /** 保存済みの投稿のうち、このSNSの件数 */
  postCount: number;
}

export interface SnsStatus {
  platforms: SnsPlatformStatus[];
  /** 最後に同期を実行した日時（成功・失敗を問わない） */
  lastCheckedAt: string | null;
  /** 最後にいずれかのSNSから取得に成功した日時 */
  lastSuccessAt: string | null;
  /** 投稿一覧を最後に保存した日時 */
  postsUpdatedAt: string | null;
  /** 直近の投稿（公開ページに表示しているものと同じ情報。最大10件） */
  recentPosts: { platform: SocialPlatform; title: string; publishedAt: string; permalink: string }[];
  /** 手動同期が次に実行できる日時（UNIX秒）。すぐ実行できる場合は null */
  manualSyncAvailableAt: number | null;
}

export async function readSnsStatus(env: SocialSyncEnv, db: D1Database): Promise<SnsStatus> {
  const [heartbeat, cache, lock] = await Promise.all([readHeartbeat(env), readCache(env), readLock(db)]);
  const configured = configuredPlatforms(env);
  const posts = cache?.posts ?? [];
  const status = heartbeat?.status ?? cache?.status;
  return {
    platforms: SNS_PLATFORMS.map((platform) => ({
      platform,
      state: displayState(configured[platform], status?.[platform]),
      postCount: posts.filter((post) => post.platform === platform).length,
    })),
    lastCheckedAt: heartbeat?.checkedAt ?? null,
    lastSuccessAt: heartbeat?.lastSuccessAt ?? null,
    postsUpdatedAt: cache?.updatedAt ?? null,
    recentPosts: [...posts]
      .sort((a, b) => b.publishedAt.localeCompare(a.publishedAt))
      .slice(0, 10)
      .map((post) => ({ platform: post.platform, title: post.title, publishedAt: post.publishedAt, permalink: post.permalink })),
    manualSyncAvailableAt: lock !== null && lock > nowSeconds() ? lock : null,
  };
}

async function readLock(db: D1Database): Promise<number | null> {
  await ensureSchema(db);
  const row = await db.prepare("SELECT locked_until FROM staff_rate_limits WHERE key = ?1").bind(RATE_LIMIT_KEY).first<{ locked_until: number }>();
  return row?.locked_until ?? null;
}

/** 手動同期の実行権を取る。直前の手動同期から間隔が空いていなければ null（実行しない） */
async function acquireCooldown(db: D1Database, now: number): Promise<boolean> {
  await ensureSchema(db);
  const row = await db
    .prepare(
      `INSERT INTO staff_rate_limits (key, locked_until) VALUES (?1, ?2)
       ON CONFLICT(key) DO UPDATE SET locked_until = excluded.locked_until WHERE staff_rate_limits.locked_until <= ?3
       RETURNING locked_until`,
    )
    .bind(RATE_LIMIT_KEY, now + MANUAL_SYNC_COOLDOWN_SECONDS, now)
    .first<{ locked_until: number }>();
  return row !== null;
}

export type ManualSyncResult =
  | { ok: true; synced: boolean; checkedAt: string; counts: Record<SnsPlatform, number>; states: Record<SnsPlatform, SnsDisplayState> }
  | { ok: false; reason: "cooldown"; retryAt: number }
  | { ok: false; reason: "failed"; checkedAt: string };

/** 「今すぐ同期」：既存の同期処理をサーバー側で実行し、要約だけを返す */
export async function runManualSnsSync(env: SocialSyncEnv, db: D1Database, actor: string): Promise<ManualSyncResult> {
  const now = nowSeconds();
  if (!(await acquireCooldown(db, now))) {
    return { ok: false, reason: "cooldown", retryAt: (await readLock(db)) ?? now + MANUAL_SYNC_COOLDOWN_SECONDS };
  }
  const audit = (detail: Record<string, unknown>) => auditStatement(db, "sns.sync", "sns", "manual", actor, detail, nowSeconds()).run();
  try {
    const result = await runSocialSync(env);
    // サーバーログ：既存の定期同期と同じ要約（秘密情報を含まない）に、手動実行の印を付ける
    console.log(JSON.stringify({ ...summarizeForLog(result), trigger: "staff-manual" }));
    const configured = configuredPlatforms(env);
    const counts = { facebook: result.facebookFetched, instagram: result.instagramFetched, threads: result.threadsFetched };
    const states = Object.fromEntries(SNS_PLATFORMS.map((p) => [p, displayState(configured[p], result.status[p])])) as Record<SnsPlatform, SnsDisplayState>;
    await audit({ ok: result.ok, ...counts });
    return { ok: true, synced: result.ok, checkedAt: result.checkedAt, counts, states };
  } catch (err) {
    console.error(JSON.stringify({ event: "staff-sns-sync-error", error: err instanceof Error ? err.name : "unknown" }));
    await audit({ ok: false, error: "exception" }).catch(() => undefined);
    return { ok: false, reason: "failed", checkedAt: new Date().toISOString() };
  }
}
