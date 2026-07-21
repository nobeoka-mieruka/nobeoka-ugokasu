// Cloudflare Pages Functions / Worker で共通して使う環境変数・バインディングの型です。
// すべての値はCloudflareダッシュボード（Pages: 環境変数、Worker: wrangler secret）から
// 注入されます。このファイル自体には値は一切含まれません。

export interface SocialSyncEnv {
  /** 投稿データのキャッシュを保存するKV名前空間 */
  SOCIAL_POSTS_KV: KVNamespace;

  /** Meta Graph APIのバージョン（例: "v21.0"）。未設定時は既定値を使用 */
  META_GRAPH_API_VERSION?: string;

  /** 「福富千恵と延岡を動かす会」FacebookページのページID */
  FACEBOOK_PAGE_ID?: string;

  /**
   * InstagramプロアカウントのユーザーID（Graph API用の数字のID）。
   * Instagramのユーザーネーム（例: "chie_smily4"）とは別の値であり、
   * ユーザーネームから推測することはできない。Meta側のGraph API Explorer等で
   * 確認した正式な値を設定すること（docs/social-sync-setup.md 参照）。
   */
  INSTAGRAM_USER_ID?: string;

  /**
   * Facebookページ・Instagramプロアカウントの投稿取得に共通で使うアクセストークン
   * （秘密情報）。InstagramのプロアカウントがFacebookページと接続されていれば、
   * 同じページアクセストークンで両方のGraph APIエンドポイントを呼び出せるため、
   * トークンは1つに統一している。
   */
  META_ACCESS_TOKEN?: string;

  /** 手動同期エンドポイントを保護する秘密キー */
  SOCIAL_SYNC_SECRET?: string;

  /** 保存・表示するSNS投稿の最大件数（文字列で渡ってくるため利用側で数値化する） */
  SOCIAL_POST_LIMIT?: string;
}
