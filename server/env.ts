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

  /**
   * ThreadsプロアカウントのユーザーID（Threads API用の数字のID）。
   * Threadsのユーザーネーム（例: "chie_smily4"）とは別の値。
   */
  THREADS_USER_ID?: string;

  /**
   * Threads API専用のアクセストークン（秘密情報）。Meta Graph API用の
   * META_ACCESS_TOKEN とは別のトークン（Threads APIは graph.threads.net という
   * 別ホスト・別の認可フローのため、同じトークンを使い回すことはできない）。
   */
  THREADS_ACCESS_TOKEN?: string;

  /** 手動同期エンドポイントを保護する秘密キー */
  SOCIAL_SYNC_SECRET?: string;

  /**
   * 定期実行Worker（worker/social-cron）が同期エンドポイントを呼び出すための秘密キー。
   * 管理者用の SOCIAL_SYNC_SECRET とは別の値にし、Worker側のSecretにも同じ値を登録する。
   */
  SOCIAL_CRON_SECRET?: string;

  /** 保存・表示するSNS投稿の最大件数（文字列で渡ってくるため利用側で数値化する） */
  SOCIAL_POST_LIMIT?: string;

  /** YouTube Data API v3のAPIキー（秘密情報）。ブラウザへは一切送信しない */
  YOUTUBE_API_KEY?: string;

  /** YouTubeチャンネルID（例: "UCxxxxxxxx"）。チャンネルページへのリンク表示に使用 */
  YOUTUBE_CHANNEL_ID?: string;

  /** チャンネルの「アップロード動画」プレイリストID。playlistItems.list呼び出しに使用 */
  YOUTUBE_UPLOADS_PLAYLIST_ID?: string;
}

/**
 * 後援会執行部ポータル（/staff/）のGoogleログインに使う設定です。
 * 設定手順は docs/staff-login-setup.md を参照。
 * いずれかが未設定の間は、誰もログインできません（フェイルクローズ）。
 *
 * SNS自動同期（/api/admin/sync-social-posts）の秘密キー認証とは完全に別物です。
 */
export interface StaffAuthEnv {
  /** セッション・ログイン失敗回数を保存するD1データベース（binding名: STAFF_DB） */
  STAFF_DB?: D1Database;
  /** Google OAuthクライアントID（公開されても問題ない値） */
  GOOGLE_CLIENT_ID?: string;
  /** Google OAuthクライアントシークレット（秘密情報。必ずSecretとして登録する） */
  GOOGLE_CLIENT_SECRET?: string;
  /** ログインを許可するメールアドレス（カンマ・空白・改行区切り。Secretとして登録する） */
  STAFF_ALLOWED_EMAILS?: string;
}

/** 公開ページ /dialogue/ が開催予定を読み込むための設定（執行部ポータルと同じD1を読み取り専用で使う） */
export interface DialogueEnv {
  STAFF_DB?: D1Database;
}

/**
 * 新しいページの公開検知（/api/admin/detect-new-pages）の設定です。
 * GitHub Actions（.github/workflows/detect-new-pages.yml）だけが呼び出します。
 */
export interface PageDetectEnv extends AssetsEnv {
  /** お知らせの下書きを保存するD1（執行部ポータルと同じ。binding名: STAFF_DB） */
  STAFF_DB?: D1Database;
  /** 呼び出しを認証する秘密キー（GitHubのSecret NEWS_DETECT_SECRET と同じ値）。未設定の間は誰も実行できない */
  NEWS_DETECT_SECRET?: string;
}

/**
 * 執行部ポータル「アクセス解析」（/staff/analytics/）がGA4 Data APIを読むための設定です。
 * Cloudflare Pagesの本番環境に「暗号化（Secret）」で登録します（手順は docs/analytics-dashboard.md）。
 *   中継方式（推奨・秘密鍵なし）：GA4_PROPERTY_ID・GA4_PROXY_URL・GA4_PROXY_SECRET
 *   鍵方式（従来）：GA4_PROPERTY_ID・GA4_SERVICE_ACCOUNT_EMAIL・GA4_SERVICE_ACCOUNT_PRIVATE_KEY
 * GA4_PROXY_URL・GA4_PROXY_SECRET のどちらかがあれば中継方式になります。
 * 必要な値が未設定の間は、画面に設定手順だけを表示し、数値は表示しません。
 */
export interface AnalyticsEnv {
  /** GA4のプロパティID（数字のみ。例: "123456789"）。G- で始まる測定ID（seoConfig.ga4Id）とは別の値 */
  GA4_PROPERTY_ID?: string;
  /** GA4プロパティに「閲覧者」として追加したサービスアカウントのメールアドレス */
  GA4_SERVICE_ACCOUNT_EMAIL?: string;
  /** サービスアカウントの秘密鍵（JSONキーの private_key。PEM形式。秘密情報） */
  GA4_SERVICE_ACCOUNT_PRIVATE_KEY?: string;
  /** GA4 中継（Cloud Run の services/ga4-proxy）の URL（例: https://ga4-proxy-xxxx.a.run.app）。HTTPS のみ */
  GA4_PROXY_URL?: string;
  /** GA4 中継と共有する署名用のシークレット（32文字以上。Google Cloud の Secret Manager と同じ値。秘密情報） */
  GA4_PROXY_SECRET?: string;
  /** 取得結果のキャッシュ先（SNS投稿と同じKVを、別のキーで使う）。無い場合はWorkerのメモリ上にキャッシュする */
  SOCIAL_POSTS_KV?: KVNamespace;
}

/** 静的ファイル（ビルド成果物）を取得するためのPages標準バインディング */
export interface AssetsEnv {
  ASSETS: Fetcher;
}
