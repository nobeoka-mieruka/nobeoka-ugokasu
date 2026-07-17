// =============================================================
// Facebook / Instagram の公式アカウント情報を一元管理するファイルです。
// URLやユーザーネームはアクセストークンのような機密情報ではないため、
// 既定値をここに直接定義しています。他のファイルへ直接書き込まず、
// 必ずこの設定を経由してください。
//
// このファイルは .astro のフロントマター（ビルド時にNode上で実行され、
// ブラウザへは配信されない部分）からのみ読み込まれる想定のため、
// クライアント公開用の PUBLIC_ 接頭辞は付けていません。
// Cloudflare Pages の「Variables and Secrets」（通常の環境変数）で
// FACEBOOK_PAGE_URL / INSTAGRAM_PROFILE_URL / INSTAGRAM_USERNAME を
// 設定すると、ビルド時にその値で上書きされます。未設定でも下記の
// 既定値（正式URL）でビルドが成功し、サイトは正常に動作します。
// =============================================================

const DEFAULT_FACEBOOK_PAGE_URL = "https://www.facebook.com/profile.php?id=61591967011155";
const DEFAULT_INSTAGRAM_PROFILE_URL = "https://www.instagram.com/chie_smily4/";
const DEFAULT_INSTAGRAM_USERNAME = "chie_smily4";

export const socialConfig = {
  /** 公式FacebookページURL */
  facebookPageUrl: import.meta.env.FACEBOOK_PAGE_URL || DEFAULT_FACEBOOK_PAGE_URL,

  /** 公式InstagramプロフィールURL */
  instagramProfileUrl: import.meta.env.INSTAGRAM_PROFILE_URL || DEFAULT_INSTAGRAM_PROFILE_URL,

  /**
   * Instagramのユーザーネーム（表示用。例: "@chie_smily4"）。
   * Meta Graph API用の INSTAGRAM_USER_ID（server/env.ts）とは別の値であり、
   * このユーザーネームからAPI用IDを推測することはできません。
   */
  instagramUsername: import.meta.env.INSTAGRAM_USERNAME || DEFAULT_INSTAGRAM_USERNAME,
} as const;

export type SocialConfig = typeof socialConfig;
