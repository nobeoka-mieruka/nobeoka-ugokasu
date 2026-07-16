// ブラウザから /api/social-posts を読み込むためのクライアント側ヘルパーです。
// アクセストークン等の秘密情報はここには一切含まれません
//（この関数は取得済みの表示用データを読むだけです）。

import type { SocialPost, SocialPostsResponse } from "../types/social";

export interface SocialPostsResult {
  posts: SocialPost[];
  updatedAt: string | null;
  /** trueの場合、API呼び出し自体に失敗したことを示す（活動報告ページ全体は壊さない） */
  fetchFailed: boolean;
}

export async function fetchSocialPosts(): Promise<SocialPostsResult> {
  try {
    const res = await fetch("/api/social-posts", { headers: { Accept: "application/json" } });
    if (!res.ok) {
      return { posts: [], updatedAt: null, fetchFailed: true };
    }
    const data = (await res.json()) as SocialPostsResponse;
    if (!Array.isArray(data.posts)) {
      return { posts: [], updatedAt: null, fetchFailed: true };
    }
    return { posts: data.posts, updatedAt: data.updatedAt ?? null, fetchFailed: false };
  } catch {
    return { posts: [], updatedAt: null, fetchFailed: true };
  }
}
