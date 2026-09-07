// =============================================================
// サイト全体の基本情報を一元管理するファイルです。
// ここを変更すると、canonical・OGP・サイトマップ・構造化データなど
// サイト全体へ自動的に反映されます。
//
// 【独自ドメインへ移行する場合】
// siteUrl の値だけを変更してください（他ファイルの変更は不要です）。
//
// 【本公開する場合】
// allowIndexing を true に変更してください（それまでは検索エンジンに
// 表示されないようnoindexが自動設定されます）。
// =============================================================

export const siteConfig = {
  /** サイト名（ブラウザタブ等に使用） */
  siteName: "福富千恵と延岡を動かす会",

  /** 団体の正式名称。サイト内で必ずこの名称に統一してください。 */
  organizationName: "福富千恵と延岡を動かす会",

  /** 本人氏名 */
  personName: "福富 千恵",

  /** 本人氏名のふりがな */
  personNameKana: "ふくとみ ちえ",

  /** 公開予定URL（末尾スラッシュなし） */
  siteUrl: "https://nobeoka-ugokasu.pages.dev",

  /** デフォルトのページタイトル（各ページで個別設定するため通常は使用されない） */
  defaultTitle: "福富千恵と延岡を動かす会｜公式ホームページ",

  /** デフォルトの説明文（各ページで個別設定するため通常は使用されない） */
  defaultDescription:
    "福富千恵と延岡を動かす会の公式ホームページです。福富千恵のプロフィール、延岡への提言、活動報告、市民の声（みんなの声）を発信しています。",

  /**
   * 共通OGP画像（1200×630px、public/images/ogp/ogp-fukutomi-20260717.png）。
   * トップページおよび個別OGP画像を持たない全ページで使用されます。
   * 差し替える場合は、SNS側のキャッシュ対策としてファイル名に日付等を含めた
   * 新しいファイル名を使い、このパスも合わせて変更してください。
   */
  defaultOgpImage: "/images/ogp/ogp-fukutomi-20260717.png",

  /** ロケール */
  locale: "ja_JP",

  /** 団体所在地 */
  postalCode: "〒882-0842",
  address: "宮崎県延岡市三ツ瀬町2丁目3番地7",

  /**
   * =========================================================
   * お問い合わせ先の一元管理（3章）
   * =========================================================
   * メールアドレスは各ページへ直接書かず、必ずこの contact を参照してください。
   * 表示には src/components/MailLink.astro を使うと、宛先の表示名・mailtoリンク・
   * スマートフォンでの折り返しがすべて自動的に揃います。
   *
   * 【使い分け】
   * ・office   … 後援会・入会・ホームページ・Googleフォーム・広報・その他事務局対応
   * ・personal … 福富千恵本人への直接連絡（本人宛の問い合わせ）
   *
   * 「事務局」と書かれている箇所で personal を使わないでください。
   * 逆に「本人へのお問い合わせ」として明示している箇所は必ず personal のままにしてください。
   */
  contact: {
    /** 福富千恵本人への直接連絡 */
    personal: {
      label: "本人へのお問い合わせ",
      /** 見出しなどで正式に名乗る場合の表示名 */
      fullLabel: "福富千恵本人へのお問い合わせ",
      email: "fukutomichie1227@gmail.com",
    },
    /** 後援会事務局あて（一般のお問い合わせ全般） */
    office: {
      label: "事務局へのお問い合わせ",
      fullLabel: "福富千恵と延岡を動かす会 事務局へのお問い合わせ",
      email: "nobeoka.ugokasu.contact@gmail.com",
    },
  },

  /**
   * 後援会事務局への連絡先メールアドレス（contact.office.email と同じ値）。
   * 構造化データなど、文字列を直接必要とする箇所のための短縮参照です。
   * 新しく書くコードでは contact.office を参照してください。
   */
  email: "nobeoka.ugokasu.contact@gmail.com",

  /**
   * 福富千恵本人への連絡先メールアドレス（contact.personal.email と同じ値）。
   * 新しく書くコードでは contact.personal を参照してください。
   */
  personalEmail: "fukutomichie1227@gmail.com",

  /**
   * ロゴ画像パス（団体名入りの正式横組みロゴ）。
   * 構造化データ（Organization.logo）に使用されます。
   */
  logo: "/images/logo/kouenkainamaeirilogo.png",

  /**
   * 検索エンジンへのインデックスを許可するかどうか。
   * 正式公開に伴い true に変更済みです。
   * 内容を再確認したい場合のみ false へ戻してください。
   */
  allowIndexing: true,

  /**
   * 選挙運動・キャンペーン向け表示の有効化フラグ。
   * true にしただけでは投票依頼文等は自動表示されません（29章参照）。
   * 実際に選挙関連の文言を追加する際は、必ず内容を個別に確認・実装してください。
   */
  campaignMode: false,

  /** サイトが本番環境かどうか（Cloudflare Pagesのビルド環境変数などから判定する想定） */
  isProduction: process.env.CF_PAGES_BRANCH === "main",
} as const;

export type SiteConfig = typeof siteConfig;
