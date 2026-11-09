// SNS投稿の「公開中のHTML（ビルド済みのページ）」が最新かどうかの判定です。
// ・.github/workflows/refresh-social-posts.yml … 再ビルドするか（デプロイフックを呼ぶか）の判定に使う
// ・scripts/monitor/site-check.mjs           … サイトの定期チェック（執行部ポータル「サイトの状態」）の判定に使う
//
// 比べるもの
//   最新 … 本番API /api/social-feed の投稿一覧から計算した署名（定期取得で更新される。閲覧者の画面はこれで最新になる）
//   公開中のビルド … /social-build-manifest.json の feedSignature（ビルドに使ったAPIの投稿一覧の署名。
//                    この項目が無い古いビルドでは signature）。検索エンジンが読むHTMLはこちらの内容
//
// 無限ループ・不要な再ビルドの防止
//   ・同じ計算方法の署名どうしを比べるため、整形の違いで永久に不一致になることがない
//   ・直前のビルドから MIN_REBUILD_INTERVAL_MINUTES 分以内は再ビルドしない（ビルド中・反映待ちの重複を防ぐ。
//     万一不一致が続いても、再ビルドはこの間隔より頻繁には起きない）
//   ・このワークフローはコミットしないため、再ビルドが次の再ビルドを呼ぶことはない

import { postsSignature } from "./social-signature.mjs";

/** 直前のビルドからこの時間（分）が過ぎるまでは再ビルドしない */
export const MIN_REBUILD_INTERVAL_MINUTES = 20;
/** 不一致がこの時間（分）以上続いたら「公開中のHTMLが古い」と判断する（サイトの定期チェック） */
export const STALE_HTML_MINUTES = 60;

/**
 * @param {{ feed: { posts?: unknown[] } | null, manifest: { generatedAt?: string, signature?: string, feedSignature?: string | null } | null, now?: number, force?: boolean }} input
 * @returns {{ rebuild: boolean, state: "match" | "stale" | "waiting" | "unknown" | "forced", latest: string | null, built: string | null, buildAgeMinutes: number | null }}
 */
export function decideSocialRebuild({ feed, manifest, now = Date.now(), force = false }) {
  const latest = feed && Array.isArray(feed.posts) ? postsSignature(feed.posts) : null;
  const built = manifest ? (manifest.feedSignature ?? manifest.signature ?? null) : null;
  const builtAt = manifest?.generatedAt ? Date.parse(manifest.generatedAt) : NaN;
  const buildAgeMinutes = Number.isFinite(builtAt) ? Math.max(0, (now - builtAt) / 60000) : null;
  const base = { latest, built, buildAgeMinutes };

  if (force) return { ...base, rebuild: true, state: "forced" };
  // 本番APIを読めない場合は判断できないため、再ビルドしない（次回に再確認）
  if (latest === null) return { ...base, rebuild: false, state: "unknown" };
  if (latest === built) return { ...base, rebuild: false, state: "match" };
  if (buildAgeMinutes !== null && buildAgeMinutes < MIN_REBUILD_INTERVAL_MINUTES) return { ...base, rebuild: false, state: "waiting" };
  return { ...base, rebuild: true, state: "stale" };
}
