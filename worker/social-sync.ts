// Cloudflare Worker: 30分ごとにFacebook・InstagramのSNS投稿を取得し、
// KVキャッシュを更新する。Cloudflare Pages（サイト本体）とは別にデプロイする、
// 独立したWorkerです（wrangler.toml参照）。
//
// デプロイ：wrangler.tomlがあるこのディレクトリで `wrangler deploy` を実行します。
// 秘密情報は `wrangler secret put <名前>` で個別に登録してください（README参照）。

import type { SocialSyncEnv } from "../server/env";
import { runSocialSync, summarizeForLog } from "../server/socialSync";

export default {
  async scheduled(_event: ScheduledEvent, env: SocialSyncEnv, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(
      (async () => {
        const result = await runSocialSync(env);
        // eslint-disable-next-line no-console
        console.log(JSON.stringify(summarizeForLog(result)));
      })(),
    );
  },

  // 動作確認用：ブラウザ等から直接アクセスした場合は簡単な案内のみ返す
  // （実際の同期はscheduled、または/api/admin/sync-social-postsから行う）
  async fetch(): Promise<Response> {
    return new Response(
      "このWorkerはCron Triggerによる自動同期専用です。手動同期は /api/admin/sync-social-posts を利用してください。",
      { status: 200, headers: { "Content-Type": "text/plain; charset=utf-8" } },
    );
  },
};
