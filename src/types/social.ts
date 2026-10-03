// Facebookページ・InstagramのSNS投稿を扱うための共通型定義です。
// フロントエンド（src/services, activities一覧ページ）と、サーバー側の同期処理
//（server/, functions/, worker/）の両方から読み込まれます。
// この型自体には秘密情報（アクセストークン等）は一切含まれません。

export type SocialPlatform = "facebook" | "instagram" | "threads";

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
  threads: PlatformSyncStatus;
}

/**
 * サイト側に保存（ミラー）済みの投稿画像の参照情報。
 * SNS同期（server/socialImages.ts）が投稿画像を取得してCloudflare KVへ保存し、
 * 自社ドメインの /api/social-image?k=... から配信する。キー（k）には投稿IDと
 * 画像のハッシュが含まれるため、画像が差し替わるとURLも変わる（キャッシュバスティング）。
 */
export interface LocalMirroredImage {
  /** サイト内の絶対パス（例: "/api/social-image?k=facebook_122105_1a2b3c4d"） */
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
  /**
   * SNS側の画像URL（同期処理の内部でのみ使用）。Meta系のCDN画像URLは時間が経つと
   * 無効になる署名付きURLのため、公開API・ビルド時スナップショットでは必ずnullにして
   * 出力し、表示には localImage だけを使う。
   */
  imageUrl: string | null;
  thumbnailUrl: string | null;
  mediaType: SocialMediaType;
  /** 複数画像（カルーセル・アルバム）投稿の場合の枚数。1枚・不明の場合は省略 */
  mediaCount?: number;
  /** 画面表示用の掲載元名称（"Facebook" | "Instagram"） */
  sourceName: string;
  /**
   * サイト側に保存済みの投稿画像。表示に使う画像はこれだけで、無い場合は画像なしの
   * カードとして表示する（SNS側の期限付きURLへは直接リンクしない）。
   */
  localImage?: LocalMirroredImage | null;
  /**
   * 画像の取得元を識別する値（SNS側画像URLのパス部分。署名・トークンを含むクエリは除く）。
   * 同じ画像を毎回ダウンロードし直さないための内部用で、公開APIには出力しない。
   */
  imageSource?: string | null;
}

/** src/data/socialPostsSnapshot.json（ビルド時に /api/social-feed から書き出したもの）1件分の形 */
export interface BuildSocialPost extends SocialPost {
  localImage: LocalMirroredImage | null;
}

/** GET /api/social-feed が返すレスポンスの形 */
export interface SocialPostsResponse {
  posts: SocialPost[];
  /** 最後にSNSからの取得が成功した日時（ISO 8601）。一度も成功していない場合はnull */
  updatedAt: string | null;
  /** 最後に定期同期を実行した日時（成功・失敗を問わない）。一度も実行していない場合はnull */
  checkedAt?: string | null;
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
