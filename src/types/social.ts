// Facebookページ・InstagramのSNS投稿を扱うための共通型定義です。
// フロントエンド（src/services, activities一覧ページ）と、サーバー側の同期処理
//（server/, functions/, worker/）の両方から読み込まれます。
// この型自体には秘密情報（アクセストークン等）は一切含まれません。

export type SocialPlatform = "facebook" | "instagram";

export type SocialMediaType = "IMAGE" | "VIDEO" | "CAROUSEL_ALBUM" | "REELS" | "LINK" | "STATUS" | "UNKNOWN";

/**
 * プラットフォームごとの直近の同期結果。
 * "ok"=正常に取得できた、"error"=認証情報はあるが取得に失敗した、
 * "not_configured"=Meta APIの認証情報が未設定（正常な状態）。
 * トークンやエラーメッセージそのものは含まない、安全に公開できる要約値。
 */
export type PlatformSyncStatus = "ok" | "error" | "not_configured";

export interface SocialFeedStatus {
  facebook: PlatformSyncStatus;
  instagram: PlatformSyncStatus;
}

/** ビルド時に画像をローカルへミラーした場合の参照情報（public/images/social/以下） */
export interface LocalMirroredImage {
  /** サイト内の絶対パス（例: "/images/social/facebook/122105.webp"） */
  src: string;
  width: number;
  height: number;
}

/** フロントエンド表示用に整形済みのSNS投稿1件分のデータ */
export interface SocialPost {
  /** 他の投稿と重複しない識別子（Facebook/Instagramの投稿IDそのもの） */
  id: string;
  platform: SocialPlatform;
  /** 投稿日時（ISO 8601形式の文字列） */
  publishedAt: string;
  /** 投稿本文・captionの先頭部分から生成した見出し */
  title: string;
  /** 投稿本文・caption（表示用に切り詰め前の全文。フロント側で180文字程度に省略表示） */
  description: string;
  /** 投稿の公開URL */
  permalink: string;
  imageUrl: string | null;
  thumbnailUrl: string | null;
  mediaType: SocialMediaType;
  /** 画面表示用の掲載元名称（"Facebook" | "Instagram"） */
  sourceName: string;
  /**
   * ビルド時同期（scripts/sync-facebook-posts.mjs）でローカルへ保存できた画像。
   * 存在する場合は、Facebook CDNの一時URLへ直接リンクせずこちらを優先して表示する。
   * 実行時API（/api/social-feed）が返す投稿には基本的に含まれない
   * （Cloudflare Pages Functionsはファイルシステムへ書き込めないため）。
   */
  localImage?: LocalMirroredImage | null;
}

/** src/data/socialPostsSnapshot.json（ビルド時同期の出力）1件分の形。SocialPostのサブセット＋localImage */
export interface BuildSocialPost extends SocialPost {
  localImage: LocalMirroredImage | null;
}

/** GET /api/social-feed が返すレスポンスの形 */
export interface SocialPostsResponse {
  posts: SocialPost[];
  /** 最後に同期が成功した日時（ISO 8601）。一度も成功していない場合はnull */
  updatedAt: string | null;
  /** trueの場合、直近の取得に失敗・スキップし、以前のキャッシュを表示していることを示す */
  stale: boolean;
  /** プラットフォームごとの直近の同期状態 */
  status: SocialFeedStatus;
  /**
   * trueの場合、Meta APIへの取得自体が（認証情報はあるのに）失敗したことを示す。
   * 未設定（not_configured）とは区別し、フロント側で「現在、最新の活動報告を
   * 取得できません」という案内を出し分けるために使う。
   */
  fetchFailed: boolean;
}

/** SocialPostsResponse の別名（Meta連携の設定手順内での呼称に合わせたエイリアス） */
export type SocialFeedResponse = SocialPostsResponse;
