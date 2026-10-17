// =============================================================
// 団体名・構造化データの@idなど、サイトの基本情報のうち
// Cloudflare Pages Functions（サーバー側）からも読み込むものを置くファイルです。
//
// siteConfig.ts は process.env などビルド環境に依存する値を含むため、Functionsからは読み込めません。
// このファイルには実行環境に依存するものを書かないでください。
// =============================================================

import { SITE_URL } from "./siteUrl";

export const ORGANIZATION_NAME = "福富千恵と延岡を動かす会";

/** 構造化データで団体（Organization）を指す@id */
export const ORGANIZATION_ID = `${SITE_URL}/#organization`;
