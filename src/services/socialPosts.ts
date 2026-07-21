// ブラウザから /api/social-feed を読み込むためのクライアント側ヘルパーです。
// アクセストークン等の秘密情報はここには一切含まれません
//（この関数は取得済みの表示用データを読むだけです）。

import type { SocialFeedStatus, SocialPost, SocialPostsResponse } from "../types/social";

const DEFAULT_STATUS: SocialFeedStatus = { facebook: "not_configured", instagram: "not_configured" };

export interface SocialPostsResult {
  posts: SocialPost[];
  updatedAt: string | null;
  /** trueの場合、API呼び出し自体（HTTPレベル）に失敗したことを示す（活動報告ページ全体は壊さない） */
  requestFailed: boolean;
  /** trueの場合、Meta APIへの取得が（認証情報はあるのに）失敗したことを示す */
  fetchFailed: boolean;
  /** プラットフォームごとの直近の同期状態 */
  status: SocialFeedStatus;
}

const FAILED_RESULT: SocialPostsResult = {
  posts: [],
  updatedAt: null,
  requestFailed: true,
  fetchFailed: true,
  status: DEFAULT_STATUS,
};

export async function fetchSocialPosts(): Promise<SocialPostsResult> {
  try {
    const res = await fetch("/api/social-feed", { headers: { Accept: "application/json" } });
    if (!res.ok) {
      return FAILED_RESULT;
    }
    const data = (await res.json()) as SocialPostsResponse;
    if (!Array.isArray(data.posts)) {
      return FAILED_RESULT;
    }
    return {
      posts: data.posts,
      updatedAt: data.updatedAt ?? null,
      requestFailed: false,
      fetchFailed: Boolean(data.fetchFailed),
      status: data.status ?? DEFAULT_STATUS,
    };
  } catch {
    return FAILED_RESULT;
  }
}
