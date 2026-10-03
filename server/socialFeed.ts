// 公開API（functions/api/social-feed.ts）から呼び出される、表示用データの組み立て役です。
// 閲覧者のアクセスをきっかけにSNSのAPIを呼ぶことはしません。SNSからの取得・画像の保存は
// 定期実行（worker/social-cron → /api/admin/sync-social-posts → server/socialSync.ts）が
// バックグラウンドで行い、ここではKVに保存済みの結果を読むだけです。

import type { SocialFeedStatus, SocialPostsResponse } from "../src/types/social";
import type { SocialSyncEnv } from "./env";
import { readCache, readHeartbeat, toPublicPost } from "./kv";

/** 定期同期がこれより長く実行されていない場合は「古い」とみなす */
const STALE_AFTER_MS = 15 * 60 * 1000;

const DEFAULT_STATUS: SocialFeedStatus = { facebook: "not_configured", instagram: "not_configured", threads: "not_configured" };

export async function getSocialFeed(env: SocialSyncEnv): Promise<SocialPostsResponse> {
  const [cached, heartbeat] = await Promise.all([readCache(env), readHeartbeat(env)]);

  const status = heartbeat?.status ?? cached?.status ?? DEFAULT_STATUS;
  const statuses = [status.facebook, status.instagram, status.threads];
  const attempted = statuses.filter((s) => s !== "not_configured");
  // 認証情報があるSNSがすべて取得に失敗している場合だけ fetchFailed とする（未設定は失敗扱いにしない）
  const fetchFailed = attempted.length > 0 && attempted.every((s) => s === "error");

  const checkedAt = heartbeat?.checkedAt ?? null;
  const checkedTooLongAgo = !checkedAt || Date.now() - Date.parse(checkedAt) > STALE_AFTER_MS;

  return {
    posts: (cached?.posts ?? []).map(toPublicPost),
    updatedAt: heartbeat?.lastSuccessAt ?? cached?.updatedAt ?? null,
    checkedAt,
    stale: fetchFailed || checkedTooLongAgo || statuses.includes("error"),
    status,
    fetchFailed,
  };
}
