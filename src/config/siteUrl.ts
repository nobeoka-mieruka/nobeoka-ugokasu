// =============================================================
// サイトの公開URL（本番URL）を一元管理するファイルです。
// canonical・OGP・サイトマップ・構造化データ（siteConfig.siteUrl 経由）と、
// 後援会執行部ポータルのGoogleログインのコールバックURL（server/googleOAuth.ts）の
// 両方がこの値を参照します。
//
// このファイルはCloudflare Pages Functions（サーバー側）からも読み込むため、
// process.env など実行環境に依存するものを書かないでください。
//
// 【独自ドメインへ移行する場合】
// この値を変更し、Google Cloud Consoleの「承認済みの JavaScript 生成元」と
// 「承認済みのリダイレクト URI」にも新しいURLを登録してください。
// =============================================================

/** 公開URL（末尾スラッシュなし） */
export const SITE_URL = "https://nobeoka-ugokasu.pages.dev";
