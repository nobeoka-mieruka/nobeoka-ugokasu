// SNS投稿の定期同期を起動するだけのWorkerです（wrangler.toml参照）。
// 実際の取得・画像保存・変更検知は、Pages Functions側の /api/admin/sync-social-posts
//（server/socialSync.ts）が行います。秘密キーはログへ出力しません。

interface Env {
  SYNC_URL: string;
  SOCIAL_CRON_SECRET?: string;
}

const TIMEOUT_MS = 25000;

async function triggerSync(env: Env): Promise<void> {
  if (!env.SOCIAL_CRON_SECRET) {
    console.warn(JSON.stringify({ event: "social-cron", ok: false, error: "SOCIAL_CRON_SECRET_not_set" }));
    return;
  }
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(env.SYNC_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${env.SOCIAL_CRON_SECRET}` },
      signal: controller.signal,
    });
    // 同期結果の要約（件数・状態のみ。秘密情報は含まれない）をログへ残す
    const summary = await res.text();
    console.log(JSON.stringify({ event: "social-cron", httpStatus: res.status, summary: summary.slice(0, 500) }));
  } catch (err) {
    console.error(JSON.stringify({ event: "social-cron", ok: false, error: err instanceof Error ? err.message : "unknown_error" }));
  } finally {
    clearTimeout(timeoutId);
  }
}

export default {
  async scheduled(_controller: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(triggerSync(env));
  },
  // HTTPからは何も実行しない（定期実行専用）
  async fetch(): Promise<Response> {
    return new Response("Not Found", { status: 404 });
  },
};
