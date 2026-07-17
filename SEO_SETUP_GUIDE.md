# SEO設定・運用ガイド

「福富千恵と延岡を動かす会」公式ホームページ（https://nobeoka-ugokasu.pages.dev ）のSEO実装内容と、公開後に必要な手作業をまとめた手順書です。

---

## 目次

1. [実装したSEO対策](#1-実装したseo対策)
2. [正規URLの方針](#2-正規urlの方針)
3. [titleとdescriptionの管理場所](#3-titleとdescriptionの管理場所)
4. [sitemap.xmlの生成方法](#4-sitemapxmlの生成方法)
5. [robots.txtの管理場所](#5-robotstxtの管理場所)
6. [構造化データの管理場所](#6-構造化データの管理場所)
7. [新しいページを追加した際のSEO設定方法](#7-新しいページを追加した際のseo設定方法)
8. [Google Search Consoleへの登録方法](#8-google-search-consoleへの登録方法)
9. [Search Console確認タグの設定方法](#9-search-console確認タグの設定方法)
10. [sitemap.xmlの送信方法](#10-sitemapxmlの送信方法)
11. [URL検査からインデックス登録をリクエストする方法](#11-url検査からインデックス登録をリクエストする方法)
12. [インデックス登録状況の確認方法](#12-インデックス登録状況の確認方法)
13. [Google検索でsite:検索を行う方法](#13-google検索でsite検索を行う方法)
14. [Core Web Vitalsの確認方法](#14-core-web-vitalsの確認方法)
15. [Rich Results Testでの確認方法](#15-rich-results-testでの確認方法)
16. [独自ドメインへ移行する場合の手順](#16-独自ドメインへ移行する場合の手順)
17. [独自ドメイン移行時のcanonicalと301設定](#17-独自ドメイン移行時のcanonicalと301設定)
18. [検索に表示されない場合の確認項目](#18-検索に表示されない場合の確認項目)
19. [title変更後、反映まで時間がかかる場合があること](#19-title変更後反映まで時間がかかる場合があること)
20. [インデックスや順位は保証されないこと](#20-インデックスや順位は保証されないこと)
21. [登録後に確認する主要URL](#21-登録後に確認する主要url)

---

## 1. 実装したSEO対策

- Astroによる完全な静的HTML生成（各ページのtitle・description・見出し・本文がJavaScript実行前のHTMLに含まれる。React SPA特有の「クロール時に中身が空」という問題は元々発生しない構成）
- 全公開ページに固有のtitle・meta description・canonical・OGP・構造化データ（`SeoHead.astro`）
- 正規URLを末尾スラッシュありに統一（詳細は2章）
- WebSite / Organization / Person / WebPage / Article / BreadcrumbList のJSON-LD構造化データ（`src/utils/structuredData.ts`）
- `robots.txt`・`sitemap.xml`の自動生成
- 「意見募集中のテーマ」12ページに、テーマごとの固有の案内文・お困りごとの例・関連リンクを追加
- OGP画像への`og:image:alt`／`twitter:image:alt`追加
- インデックス対象ページのrobotsメタに`max-image-preview:large, max-snippet:-1, max-video-preview:-1`を追加
- ビルド後にSEOの基本要件を自動検査する`npm run seo:check`を追加

---

## 2. 正規URLの方針

**末尾スラッシュあり**（例：`https://nobeoka-ugokasu.pages.dev/profile/`）を正規URLとします。

理由：Cloudflare Pagesは末尾スラッシュなしのURL（`/profile`）を末尾スラッシュあり（`/profile/`）へ自動的に308リダイレクトする仕様のため、canonicalが末尾スラッシュなしのままだと「リダイレクトされる側のURL」を指してしまいます。トップページ（`/`）はそのままで正規URLです。

この方針は以下すべてで一致しています：
- canonical（`<link rel="canonical">`）
- `og:url`
- JSON-LDの`url`（WebPage・Article・BreadcrumbList等）
- サイト内の内部リンク（ヘッダー・フッター・パンくず・関連リンク・カード等）
- `sitemap.xml`のURL

`astro.config.mjs`の`trailingSlash: "always"`設定により、開発サーバー（`astro dev`）でも本番と同じ挙動になります。

新しいページ・リンクを追加する際は、内部リンクの`href`に必ず末尾スラッシュを付けてください（画像・PDF・`sitemap.xml`など拡張子を持つファイルURLには付けません）。`src/utils/seo.ts`の`withTrailingSlash()`（`absoluteUrl()`が内部で使用）で自動的に正規化されますが、`<a href="...">`を直接書く場合は手動で末尾スラッシュを付ける必要があります。

---

## 3. titleとdescriptionの管理場所

各ページの`.astro`ファイル冒頭（フロントマター部分）で、`const title = "..."` `const description = "..."` として個別に定義し、`<BaseLayout title={title} description={description} ...>` へ渡しています。共通のサイト名・URL等は `src/config/siteConfig.ts` で一元管理されています（独自ドメイン移行時は`siteUrl`のみ変更すれば全ページのcanonical・sitemap・OGP・構造化データに反映されます）。

Markdownコンテンツ（活動報告・お知らせ・意見募集分析結果等、`src/content/`配下）はfrontmatterの`title`・`summary`／`description`をそれぞれのページが読み込んで使用しています。

---

## 4. sitemap.xmlの生成方法

`@astrojs/sitemap`（`astro.config.mjs`）により、`npm run build`実行時に自動生成されます（手動でのURL列挙は不要）。`noindex`のページ（`/voices/submit/`、下書き中の`/issues/*`、`/404.html`）は`astro.config.mjs`の`sitemap()`の`filter`で除外しています。

新しいコンテンツ（活動報告・お知らせ等）を`published: true`で公開すると、自動的にsitemapへ追加されます。

生成物：`dist/sitemap-index.xml`（索引）＋ `dist/sitemap-0.xml`（実際のURL一覧）。公開URLは https://nobeoka-ugokasu.pages.dev/sitemap-index.xml です。

---

## 5. robots.txtの管理場所

`src/pages/robots.txt.ts`（動的生成）。`siteConfig.allowIndexing`が`true`の間は`Allow: /`＋sitemapの案内、`false`の間（下書き公開前など）は`Disallow: /`を出力します。公開URル：https://nobeoka-ugokasu.pages.dev/robots.txt

---

## 6. 構造化データの管理場所

`src/utils/structuredData.ts`に、`organizationSchema()` `websiteSchema()` `personSchema()` `webPageSchema()` `articleSchema()` `faqPageSchema()`の各関数があります。各ページのフロントマターで必要な関数を呼び出し、`schemas`配列として`BaseLayout`へ渡すと、`StructuredData.astro`がJSON-LDとして出力します。パンくずリストは`src/utils/seo.ts`の`buildBreadcrumbList()`を使用し、画面表示のパンくず（`Breadcrumb.astro`）と同じ`breadcrumbItems`配列から生成しているため、表示内容と構造化データは常に一致します。

**画面に実際に表示されていない情報を構造化データだけに追加しないでください**（`StructuredData.astro`冒頭にも明記されています）。

---

## 7. 新しいページを追加した際のSEO設定方法

1. `.astro`ファイルのフロントマターで、そのページ固有の`title`・`description`を定義する（他ページと重複しない、内容を正確に要約した文章にする）
2. `<BaseLayout title={title} description={description} path="/新しいパス/" schemas={schemas}>`を呼び出す（`path`には末尾スラッシュを付ける）
3. `Breadcrumb`を設置する場合は`breadcrumbItems`配列を定義し、`buildBreadcrumbList(breadcrumbItems)`をschemasに含める
4. 必要に応じて`webPageSchema()`等をschemasに追加する
5. h1を1つだけ設置する（`HeroSection`等の既存コンポーネントを使う場合は自動的に1つになります）
6. 他の主要ページから、そのページへの内部リンク（`href`、末尾スラッシュあり）を最低1箇所は設置する（孤立ページを作らない）
7. `npm run build && npm run seo:check`で確認する

---

## 8. Google Search Consoleへの登録方法

1. https://search.google.com/search-console/ にアクセスし、Googleアカウントでログインする
2. 「プロパティを追加」→「URLプレフィックス」で `https://nobeoka-ugokasu.pages.dev` を入力する
3. 所有権の確認方法は複数ありますが、本サイトでは「HTMLタグ」方式（9章参照）を推奨します

---

## 9. Search Console確認タグの設定方法

このサイトのコードは既に対応済みです（`src/config/seoConfig.ts` → `PUBLIC_GSC_VERIFICATION`環境変数 → `SeoHead.astro`が条件付きで`<meta name="google-site-verification" content="...">`を出力）。値が空の間は何も出力されません。**確認タグの値をコードへ直接記載しないでください。**

設定手順：
1. Search Consoleの所有権確認画面で「HTMLタグ」を選択し、`content="..."`の値（英数字の文字列）をコピーする
2. Cloudflareダッシュボード →「Workers & Pages」→ 本サイトのPagesプロジェクト →「Settings」→「Environment variables」を開く
3. 変数名 `PUBLIC_GSC_VERIFICATION`、値にコピーした文字列を、**Production環境**に設定する（Previewでも確認したい場合はPreview環境にも設定する）
4. 設定を保存しただけでは公開済みサイトへ反映されないため、Cloudflareダッシュボードの「Deployments」から最新のデプロイを「Retry deployment」するか、リポジトリへ何か変更をpushして再デプロイする
5. 再デプロイ後、本番サイトのHTMLソースに`google-site-verification`タグが出力されていることを確認する
6. Search Console側で「確認」ボタンを押す

**このサイト専用の値のみを使用してください。他のサイト・別プロジェクトの確認タグを流用しないでください。**

---

## 10. sitemap.xmlの送信方法

1. Search Consoleの左メニュー「サイトマップ」を開く
2. 「新しいサイトマップの追加」に `sitemap-index.xml` と入力して送信する（フルURLではなくプロパティからの相対パス）
3. ステータスが「成功しました」になれば送信完了

---

## 11. URL検査からインデックス登録をリクエストする方法

1. Search Console上部の検索バーに、確認したいURL（例：`https://nobeoka-ugokasu.pages.dev/profile/`）を入力する
2. 「URL検査」結果が表示されたら、「インデックス登録をリクエスト」を押す
3. 新規公開ページや大きく内容を更新したページで特に有効です（すべてのページに毎回行う必要はありません）

---

## 12. インデックス登録状況の確認方法

Search Console左メニュー「ページ」（旧「カバレッジ」）で、「インデックス登録済み」「インデックス未登録」の内訳と理由を確認できます。個別URLは11章の「URL検査」でも確認できます。

---

## 13. Google検索でsite:検索を行う方法

Google検索で `site:nobeoka-ugokasu.pages.dev` と検索すると、その時点でGoogleにインデックスされているページの一覧が（目安として）表示されます。正確な件数や網羅性の保証はありません（20章参照）。

---

## 14. Core Web Vitalsの確認方法

- Search Console左メニュー「ウェブに関する主な指標」（実際のユーザーデータが一定量たまってから表示されます）
- https://pagespeed.web.dev/ にサイトの本番URLを入力して個別ページを計測する
- Chrome DevTools の「Lighthouse」パネル（本番URL・モバイル/デスクトップ双方で計測）

---

## 15. Rich Results Testでの確認方法

https://search.google.com/test/rich-results にページURLを入力するか、HTMLを貼り付けると、構造化データ（JSON-LD）が正しく認識されるか、エラー・警告がないかを確認できます。トップページ（WebSite/Organization）、プロフィールページ（Person）、パンくずのあるページ（BreadcrumbList）、活動報告個別ページ（Article）でそれぞれ確認することを推奨します。

---

## 16. 独自ドメインへ移行する場合の手順

1. Cloudflare Pagesのプロジェクト設定でカスタムドメインを追加し、DNSを設定する
2. `src/config/siteConfig.ts`の`siteUrl`を新しいドメインへ変更する（**この1箇所のみ**。canonical・OGP・sitemap・構造化データすべてがこの値を参照しているため、他ファイルの変更は不要）
3. `npm run build && npm run seo:check`でエラーがないことを確認する
4. 変更をコミット・pushし、Cloudflare Pagesへデプロイする

---

## 17. 独自ドメイン移行時のcanonicalと301設定

1. 移行後は、旧URL（`nobeoka-ugokasu.pages.dev`）から新URL（独自ドメイン）へ301リダイレクトを設定することを強く推奨します（Cloudflare Pagesのカスタムドメイン設定、またはDNS/プロキシ側の設定で対応）
2. `siteUrl`変更後の再ビルドにより、canonical・sitemap・OGP・JSON-LDはすべて新ドメインを指すようになります（16章の手順を実施していれば旧ドメインを指すcanonicalは残りません）
3. Search Consoleで新ドメインのプロパティを別途登録し、9〜10章の手順で確認タグ設定・サイトマップ送信を行う（プロパティはドメインごとに独立しているため、旧プロパティの設定は自動的には引き継がれません）
4. 旧プロパティ側で「アドレス変更」ツール（Search Console内）が使える場合は、あわせて実施すると移行がスムーズです

---

## 18. 検索に表示されない場合の確認項目

- Search Consoleの「URL検査」で対象ページが「インデックス登録済み」になっているか確認する
- `https://nobeoka-ugokasu.pages.dev/robots.txt` が正しく開け、対象ページをDisallowしていないか確認する
- 対象ページのHTMLソースに`<meta name="robots" content="noindex...">`が誤って出力されていないか確認する（`npm run seo:check`でも検出されます）
- `https://nobeoka-ugokasu.pages.dev/sitemap-index.xml` に対象ページが含まれているか確認する
- 公開直後は反映まで時間がかかる（19章参照）
- ページの内容が極端に薄い、他ページと酷似していないか確認する
- 内部リンクが少なくとも1箇所、他ページから対象ページへ張られているか確認する（孤立ページはクロールされにくくなります）

---

## 19. title変更後、反映まで時間がかかる場合があること

titleやdescriptionを変更しても、Google検索結果に反映されるまで数日〜数週間かかることがあります。11章の「インデックス登録をリクエスト」で早められる場合がありますが、確実な即時反映を保証するものではありません。

---

## 20. インデックスや順位は保証されないこと

本ガイドの対応はすべて「検索エンジンがサイトを正しく発見・理解できる状態を整える」ためのものであり、**特定のキーワードでの検索順位や、掲載順位・上位表示・インデックス登録そのものを保証するものではありません。** 実際の掲載・順位は検索エンジン側のアルゴリズムやコンテンツの評価により決まります。

---

## 21. 登録後に確認する主要URL

- トップページ：https://nobeoka-ugokasu.pages.dev/
- プロフィール：https://nobeoka-ugokasu.pages.dev/profile/
- 私たちの提言：https://nobeoka-ugokasu.pages.dev/vision/
- 活動報告：https://nobeoka-ugokasu.pages.dev/activities/
- みんなの声：https://nobeoka-ugokasu.pages.dev/voices/
- 意見募集中のテーマ：https://nobeoka-ugokasu.pages.dev/voices/themes/
- 後援会について：https://nobeoka-ugokasu.pages.dev/supporters/
- 後援会に入会する：https://nobeoka-ugokasu.pages.dev/supporters/join/
- 市役所案内：https://nobeoka-ugokasu.pages.dev/city-guide/
- お問い合わせ：https://nobeoka-ugokasu.pages.dev/contact/
- サイトマップ：https://nobeoka-ugokasu.pages.dev/sitemap-index.xml
- robots.txt：https://nobeoka-ugokasu.pages.dev/robots.txt
