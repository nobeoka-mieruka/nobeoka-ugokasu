# 福富千恵と延岡を動かす会 公式ホームページ

政治団体「福富千恵と延岡を動かす会」の公式ホームページです。
Astro + TypeScript + Tailwind CSSで構築された静的サイトで、Cloudflare Pagesでの公開を想定しています。

このREADMEは、エンジニアでない方でも更新作業ができるように、できるだけ分かりやすく書いています。

---

## 目次

1. [サイトを起動する方法](#1-サイトを起動する方法)
2. [文章を変更する方法](#2-文章を変更する方法)
3. [プロフィールを変更する方法](#3-プロフィールを変更する方法)
4. [写真を変更する方法](#4-写真を変更する方法)
5. [活動報告を追加する方法](#5-活動報告を追加する方法)
   - [5-2. FacebookやInstagramの投稿を追加する方法](#5-2-facebookやinstagramの投稿を追加する方法)
6. [お知らせを追加する方法](#6-お知らせを追加する方法)
7. [提言を更新する方法](#7-提言を更新する方法)
8. [意見募集テーマを追加する方法](#8-意見募集テーマを追加する方法)
9. [分析結果を公開する方法](#9-分析結果を公開する方法)
10. [GoogleフォームURLを設定する方法](#10-googleフォームurlを設定する方法)
11. [LINEとFacebook・Instagramを設定する方法](#11-lineとfacebookinstagramを設定する方法)
12. [OGP画像を変更する方法](#12-ogp画像を変更する方法)
13. [公開URLを変更する方法](#13-公開urlを変更する方法)
14. [allowIndexingをtrueにする方法](#14-allowindexingをtrueにする方法)
15. [campaignModeの説明](#15-campaignmodeの説明)
16. [Google Search Consoleの設定](#16-google-search-consoleの設定)
17. [サイトマップの送信方法](#17-サイトマップの送信方法)
18. [Google Analyticsの設定](#18-google-analyticsの設定)
19. [Cloudflare Pagesへの公開方法](#19-cloudflare-pagesへの公開方法)
20. [GitHubへ反映する方法](#20-githubへ反映する方法)
21. [独自ドメインへ移行する方法](#21-独自ドメインへ移行する方法)
22. [個人情報を公開しないための確認](#22-個人情報を公開しないための確認)
23. [公職選挙法上の確認が必要な項目](#23-公職選挙法上の確認が必要な項目)
24. [公開前チェックリスト](#24-公開前チェックリスト)
25. [動画（YouTube）を追加する方法](#25-動画youtubeを追加する方法)

---

## 1. サイトを起動する方法

事前に [Node.js](https://nodejs.org/)（18以上推奨）をインストールしてください。

```bash
npm install
npm run dev
```

ブラウザで `http://localhost:4321` を開くとサイトが確認できます。ファイルを保存すると自動で画面が更新されます。

停止するには、ターミナルで `Ctrl + C` を押してください。

---

## 2. 文章を変更する方法

サイト内の主な文章は、以下のファイルにまとまっています。

| 内容 | ファイル |
|---|---|
| トップページ | `src/pages/index.astro` |
| プロフィール本文 | `src/data/profile.ts` |
| 提言の内容 | `src/data/vision.ts` |
| ナビゲーションメニュー | `src/data/navigation.ts` |
| 団体名・住所・メール等 | `src/config/siteConfig.ts` |

`.astro` ファイルはHTMLに似た形式です。日本語の文章部分だけを書き換えれば、レイアウトを壊さずに更新できます。

---

## 3. プロフィールを変更する方法

`src/data/profile.ts` を開いてください。

- `profileBasics`：氏名・生年月日・学歴・経歴などの基本情報
- `profileChapters`：プロフィールページの各章（見出しと本文）
- `profileClosingMessage`：プロフィールページ末尾のメッセージ

**注意**：確認できていない経歴・資格・実績・受賞歴は追加しないでください。事実確認ができた内容のみ追記してください。

---

## 4. 写真を変更する方法

### トップページ・プロフィールページの人物写真（自動でWebP/AVIF最適化される場合）

トップページとプロフィールページの福富千恵さんの写真は、`src/assets/images/profile/fukutomi-chie.jpg` を使っています。
このフォルダの画像は、ビルド時に自動でAVIF/WebPへの変換・複数サイズへのリサイズ・`srcset`生成が行われます（`astro:assets`の`<Picture>`コンポーネントを使用）。

写真を差し替える手順：

1. 高解像度の正方形に近い写真（顔が写真の中心付近にあるもの）を用意します。
2. `src/assets/images/profile/fukutomi-chie.jpg` を新しい写真で上書きします（同じファイル名でOKです。別名にする場合は、後述のimport文も変更してください）。
3. `npm run dev` または `npm run build` を実行すると、自動的に新しい写真から最適化画像が生成されます。
4. 顔が見切れる場合は、`src/pages/index.astro` と `src/pages/profile.astro` 内の
   `style="object-position: center 30%;"`（または`center 25%;`）の数値（0%が上、100%が下）を調整してください。
5. `alt="..."` の説明文も、実際の写真内容に合わせて書き換えてください。

### その他の写真（活動報告・お知らせなど）

活動報告やお知らせの写真は、最適化パイプラインを通さず`public/images/`配下のフォルダにそのまま保存する簡易な方式です。

1. 高解像度の写真ファイル（JPEG/PNG推奨、可能であればWebP/AVIFに変換したものを用意）を用意します。
2. 該当するフォルダ（例：`public/images/activities/`）に保存します。
3. Markdownファイルのfrontmatter（`mainImage.src`など）に画像パスを記入します。
4. `alt` の説明文も、実際の写真内容に合わせて記入してください。

画像フォルダの用途は以下の通りです。

| フォルダ | 用途 |
|---|---|
| `public/images/profile/` | 福富千恵の人物写真 |
| `public/images/activities/` | 活動報告の写真 |
| `public/images/news/` | お知らせ関連の画像 |
| `public/images/voices/` | みんなの声関連の画像 |
| `public/images/flyers/` | ビラのスキャン画像（参考資料用） |
| `public/images/signs/` | 看板のスキャン画像（参考資料用） |
| `public/images/common/` | 共通で使う装飾画像等 |
| `public/images/logo/` | ロゴ画像（正式ロゴ設定済み） |
| `public/images/ogp/` | SNS共有用OGP画像 |

---

## 5. 活動報告を追加する方法

`src/content/activities/_TEMPLATE.md.example` をコピーして、同じフォルダに新しいファイル名（例：`2026-02-shien-koryukai.md`）で保存してください。

frontmatter（ファイル先頭の`---`で囲まれた部分）に必要事項を入力し、本文に「活動の目的」「実施内容」「参加者から寄せられた声」「分かった課題」「今後の対応」を記入します。

公開する準備ができたら、frontmatterの `published: false` を `published: true` に変更してください（`false`のままだとサイトに表示されません）。

**実際に行っていない活動は作成しないでください。日付や場所を推測で埋めないでください。**

---

### 5-2. FacebookやInstagramの投稿を追加する方法

活動報告ページ（`/activities`）では、公式サイトの活動報告に加えて、Facebook・Instagramで公開した投稿も一覧に表示できます。Meta APIやアクセストークンは不要で、投稿URLを手動で登録するだけの方式です。

**設定ファイル**：`src/data/snsActivities.ts`

1. Facebook／Instagramで対象の投稿を「公開」設定で開き、投稿のURLをコピーする
2. `src/data/snsActivities.ts` の `snsActivities` 配列に、次の項目を入力した1件を追加する

   | 項目 | 内容 |
   |---|---|
   | `id` | 他と重複しない半角英数字（例：`"2026-08-01-summer-festival"`） |
   | `date` | 投稿日（`"YYYY-MM-DD"`形式） |
   | `title` | 活動報告の見出し |
   | `description` | 短い説明文（長い場合はカード上で自動的に省略されます） |
   | `platform` | `"facebook"` または `"instagram"` |
   | `postUrl` | 投稿の公開URL |
   | `image` | サムネイル画像（省略可。省略時はアイコンのプレースホルダーを表示） |
   | `embedEnabled` | 投稿の埋め込み表示ボタンを出す場合は `true` |

3. 保存すると、`npm run build`（または開発サーバー）で自動的に活動報告ページへ反映されます。並び順は投稿日の新しい順に自動で並び替えられます。

**Facebookに投稿した例：**
```ts
{
  id: "2026-08-01-summer-festival",
  date: "2026-08-01",
  title: "夏祭りに参加しました",
  description: "地域の夏祭りで啓発活動を行いました。",
  platform: "facebook",
  postUrl: "https://www.facebook.com/xxxxx/posts/xxxxx",
  image: { src: "/images/activities/sns/2026-08-01.jpg", alt: "夏祭りで啓発活動を行う様子" },
  embedEnabled: true,
},
```

**Instagramに投稿した例：**
```ts
{
  id: "2026-08-01-summer-festival-ig",
  date: "2026-08-01",
  title: "夏祭りに参加しました",
  description: "地域の夏祭りで啓発活動を行いました。",
  platform: "instagram",
  postUrl: "https://www.instagram.com/p/xxxxxxxxxxx/",
  embedEnabled: true,
},
```

**同じ内容をFacebookとInstagramの両方に投稿した場合**：カードを2枚に分けず1枚にまとめられます。上記のいずれかのエントリーに `crossPostPlatform` と `crossPostUrl` を追加してください。

```ts
{
  // ...上記のFacebook投稿の例に加えて
  crossPostPlatform: "instagram",
  crossPostUrl: "https://www.instagram.com/p/xxxxxxxxxxx/",
},
```

**公式アカウントのURL設定場所**：`src/config/socialConfig.ts` で一元管理しています（正式URLが既定値として設定済みのため、通常は変更不要です）。`src/data/socialLinks.ts` の `facebook` / `instagram` はここから値を読み込むだけで、直接書き換えないでください。SNS投稿がまだ1件も登録されていない、またはFacebook・Instagramタブに投稿がない場合、活動報告ページに「SNSでも活動を発信しています」という案内とあわせて、公式URLへのリンクボタン（「Facebookを見る」「Instagramを見る」）が自動的に表示されます。

**投稿が表示されない・埋め込みが読み込まれない場合の確認方法**：
- `postUrl` が実際に「公開」設定の投稿を指しているか確認してください（非公開・友達限定の投稿は埋め込めません）
- Facebookの埋め込みは `https://www.facebook.com/plugins/post.php?href=...`、Instagramの埋め込みは投稿URLの末尾に`/embed`を付けた公式エンドポイントを利用しています。ブラウザの広告ブロッカーやトラッキング防止設定によって読み込みがブロックされる場合がありますが、その場合もタイトル・日付・説明文・画像・投稿リンクは表示され続けます
- 埋め込みが崩れる場合でも、「Facebookで見る」「Instagramで見る」ボタンから投稿を直接確認できます

---

### 5-3. FacebookページとInstagramの投稿を自動反映する仕組み（上級者向け）

5-2の手動登録とは別に、FacebookページとInstagramプロアカウントへ新しく投稿すると、10分ごとに自動で活動報告ページへ反映される仕組みも用意されています（遅くとも15分程度での反映が目安です）。Meta Graph APIとCloudflareを使った仕組みで、アクセストークン等の秘密情報はCloudflareの暗号化されたSecretsにのみ保存し、GitHubやフロントエンドのコードには一切含まれません。

- 設定手順は [META_SOCIAL_SETUP.md](./META_SOCIAL_SETUP.md)（詳しいMeta側の操作は [docs/social-sync-setup.md](./docs/social-sync-setup.md)）にまとめています
- 設定が完了するまでは、この機能は自動的に「投稿0件」として扱われ、活動報告ページには「SNSでも活動を発信しています」という案内とFacebook・Instagramの公式URLへのボタンが表示されます。5-2の手動登録やサイトのデザインには一切影響しません
- 手動登録した投稿と、自動取得された投稿で同じURLのものがある場合は、重複せず1件だけ表示されます
- 片方のSNS（例：Instagram）だけ取得に失敗しても、もう片方（Facebook）の投稿は通常どおり表示されます

---

## 6. お知らせを追加する方法

`src/content/news/_TEMPLATE.md.example` をコピーして、同じフォルダに新しいファイルとして保存してください。`category`は次のいずれかを指定します。

`お知らせ` / `活動予定` / `意見交換会` / `活動報告` / `後援会` / `サイト更新`

活動報告と同様、公開時は `published: true` に変更してください。

---

## 7. 提言を更新する方法

提言の骨子は `src/data/vision.ts` にあります。背景・現在感じている課題・提言の内容・目指す変化・市民の声・現在の検討状況を、確認できた内容に沿って更新してください。

各課題別ページ（福祉・子育て・防災）の本文は `src/content/issues/` フォルダのMarkdownファイルで管理しています。内容が十分に充実したら、frontmatterの `draft: true` を `draft: false` に変更すると検索エンジンに表示されるようになります。

**予算額・開始時期・財源・達成率など、確認できていない情報は追加しないでください。**

---

## 8. 意見募集テーマを追加する方法

`src/data/voiceThemes.ts` を編集します。新しいテーマを配列に追加するか、既存テーマの `status`（準備中／受付中／集計中／結果公開中／受付終了）や `period`（募集期間）を更新してください。

**実際に決まっていない募集期間を設定しないでください。**

---

## 9. 分析結果を公開する方法

`src/content/voice-reports/_TEMPLATE.md.example` をコピーして新しいファイルを作成し、12-6章の運用手順（下記）に沿って確認済みの内容のみを記入してください。

1. 回答を収集する
2. 個人情報を削除する
3. 事務局が内容を確認する
4. 必要に応じてAIで分類・要約する
5. 事務局が元の文章と照合する
6. 確認後の内容だけを公開する

記入後、`published: true` に変更すると公開されます。**意見の原文や個人情報は、このリポジトリに保存しないでください。**

---

## 10. GoogleフォームURLを設定する方法

`src/config/voicesConfig.ts` を開き、`googleFormUrl` に発行したGoogleフォームのURLを入力してください。

```ts
googleFormUrl: "https://forms.gle/xxxxxxxxxxxx",
```

空欄のままだと、サイト上には「現在、意見受付フォームを準備しています。」と表示されます。

---

## 11. LINEとFacebook・Instagramを設定する方法

**Facebook・Instagram**：公式アカウントのURLは `src/config/socialConfig.ts` に既定値として設定済みです。ヘッダー・フッター・スマートフォンメニュー・活動報告ページなど、サイト内のすべてのFacebook/Instagramリンクはこの1箇所から自動的に反映されます。URLを変更する必要がある場合のみ、このファイルの`DEFAULT_FACEBOOK_PAGE_URL` / `DEFAULT_INSTAGRAM_PROFILE_URL`を書き換えるか、環境変数 `FACEBOOK_PAGE_URL` / `INSTAGRAM_PROFILE_URL` で上書きしてください（`.env.example` 参照）。`src/data/socialLinks.ts` を直接書き換える必要はありません。

**LINE**：`src/data/socialLinks.ts` を開き、該当するURLを入力してください。

```ts
line: "https://line.me/xxxxx",
```

空欄の項目はボタンが自動的に非表示になります。**確認できていないアカウントのURLは入力しないでください。**

---

## 12. OGP画像を変更する方法

**保存場所**：`public/images/ogp/ogp-fukutomi-20260717.png`（1200×630px）

トップページを含め、個別のOGP画像を持たない全ページで共通のOGP画像として使用されています（`src/config/siteConfig.ts` の `defaultOgpImage` で指定）。

「あなたと、延岡を動かす！」「福富千恵と延岡を動かす会」の文言と福富千恵の写真を含んだデザインで、Facebook・X（旧Twitter）・LINE・Discordなどで共有した際に正しく表示されることを確認済みです（`twitter:card` は `summary_large_image` を使用）。

差し替える手順：

1. 1200px × 630pxの画像（PNG推奨）を用意します。スマートフォンでも文字が読める大きさにしてください。
2. `public/images/ogp/` に新しいファイルを追加します。**ファイル名は毎回変更してください**（例：`ogp-fukutomi-20260901.png` のように日付を含める）。FacebookやLINEなどSNS側は画像を「URL単位」でキャッシュするため、同じファイル名のまま中身だけ差し替えると、SNS側に古い画像が表示され続けることがあります。
3. `src/config/siteConfig.ts` の `defaultOgpImage` のパスを新しいファイル名に変更します。
4. 古くなった画像ファイルは `public/images/ogp/` から削除してください。
5. `npm run build` を実行し、`dist/index.html` の `og:image` タグが新しい画像を指しているか確認してください。

活動記事など個別ページ独自のOGP画像を使いたい場合は、Content Collectionsの `mainImage` を設定すると自動的に反映されます。

**関連ファイル**（OGP設定を一元管理）：

- `src/config/siteConfig.ts` — OGP画像パス（`defaultOgpImage`）
- `src/config/seoConfig.ts` — Twitterカード種別、OGP画像の幅・高さ
- `src/components/SeoHead.astro` — `og:image` `og:title` `og:description` 等のmetaタグ出力
- `src/utils/structuredData.ts` — WebPage構造化データの `primaryImageOfPage`

---

## 13. 公開URLを変更する方法

`src/config/siteConfig.ts` の `siteUrl` を変更するだけで、canonical・OGP・サイトマップ・構造化データなどサイト全体へ自動的に反映されます。他のファイルを変更する必要はありません。

---

## 14. allowIndexingをtrueにする方法

`src/config/siteConfig.ts` の `allowIndexing` を `false` から `true` に変更すると、検索エンジンへの表示（インデックス）が許可されます。

**正式公開に伴い、`allowIndexing` は `true` に変更済みです。** 内容を再確認したい場合など、再びクロールを止めたいときは `false` に戻してください。

---

## 15. campaignModeの説明

`src/config/siteConfig.ts` の `campaignMode` は、選挙運動向け表示の切り替えフラグとして用意しています。初期値は `false` です。

**`true` にしただけでは、投票依頼文などは自動的に表示されません。** 選挙関連の文言を追加する場合は、必ず内容を個別に確認し、実装してください（[23. 公職選挙法上の確認が必要な項目](#23-公職選挙法上の確認が必要な項目)を参照）。

---

## 16. Google Search Consoleの設定

1. [Google Search Console](https://search.google.com/search-console) にアクセスし、サイトを登録します。
2. 所有権確認方法として「HTMLタグ」を選び、`content="..."` の値をコピーします。
3. プロジェクト直下に `.env` ファイルを作成し（`.env.example` をコピー）、以下を設定します。

```
PUBLIC_GSC_VERIFICATION=コピーした値
```

4. サイトを再ビルド・再公開すると、`<meta name="google-site-verification">` タグが出力され、所有権が確認できます。

---

## 17. サイトマップの送信方法

サイトは `npm run build` 時に自動で `sitemap-index.xml` を生成します（`@astrojs/sitemap`）。

1. Search Consoleの「サイトマップ」メニューを開きます。
2. `sitemap-index.xml` と入力して送信します。

下書き状態（noindex）のページはサイトマップに含まれません。

---

## 18. Google Analyticsの設定

1. GA4のプロパティを作成し、測定ID（`G-`から始まる文字列）を取得します。
2. `.env` に以下を設定します。

```
PUBLIC_GA4_ID=G-XXXXXXXXXX
```

3. 再ビルドすると計測タグが読み込まれます。測定IDが空欄の間はタグが読み込まれません。

---

## 19. Cloudflare Pagesへの公開方法

1. [Cloudflare Pages](https://pages.cloudflare.com/) にログインし、「Create a project」からGitHubリポジトリ（`nobeoka-ugokasu`）を連携します。
2. ビルド設定は以下の通りです。

   - フレームワークプリセット：Astro
   - ビルドコマンド：`npm run build`
   - ビルド出力ディレクトリ：`dist`

3. 環境変数（`.env`の内容）をCloudflare Pagesの「Environment variables」にも設定してください。
4. デプロイが完了すると `https://<プロジェクト名>.pages.dev` で公開されます。

---

## 20. GitHubへ反映する方法

```bash
git add .
git commit -m "更新内容の説明"
git push
```

Cloudflare Pagesと連携していれば、pushするだけで自動的に再デプロイされます。

---

## 21. 独自ドメインへ移行する方法

1. Cloudflare Pagesの「Custom domains」から独自ドメインを追加します。
2. `src/config/siteConfig.ts` の `siteUrl` を新しいドメインに変更します。
3. Search Consoleに新しいドメインのプロパティを追加し、所有権確認・サイトマップ送信をやり直します（[16](#16-google-search-consoleの設定)・[17](#17-サイトマップの送信方法)参照）。
4. 旧URLから新URLへのリダイレクトが必要な場合は、Cloudflare Pagesの `_redirects` 設定を検討してください。

---

## 22. 個人情報を公開しないための確認

- `src/content/` フォルダには、匿名化・要約済みの内容のみを保存してください。アンケートの原文や個人が特定できる情報は絶対に保存しないでください。
- `.env` ファイルは `.gitignore` で除外されています。GitHubにコミットしないでください。
- コミット前に `git status` で差分を確認し、個人情報を含むファイルが含まれていないか確認してください。

---

## 23. 公職選挙法上の確認が必要な項目

以下の項目は、公開前に必ず延岡市選挙管理委員会または専門家（弁護士・行政書士等）へ確認してください。このサイトのコードには、これらの機能は実装していません。

- [ ] サイトの公開時期
- [ ] 投票を依頼する文言の追加可否・表現方法
- [ ] 選挙期間中の表示内容・更新可否
- [ ] 有料広告の出稿
- [ ] 寄附・献金のオンライン決済の導入
- [ ] メール配信（選挙運動用電子メール送信の規制）
- [ ] 推薦者一覧・支持者コメントの掲載可否
- [ ] `campaignMode` を `true` にするタイミングと表示内容

---

## 24. 公開前チェックリスト

- [x] `npm install` が正常に完了する
- [x] `npm run dev` が正常に起動する
- [x] `npm run build` が正常に完了する（`astro check` 0エラー、31ページ生成）
- [x] スマートフォンで横スクロールが発生しない
- [x] 人物写真の顔が切れていない（実写真に差し替え済み。デスクトップ・モバイルでスクリーンショット確認済み）
- [x] 正式団体名が「福富千恵と延岡を動かす会」に統一されている
- [x] 架空の経歴・実績・電話番号がない
- [x] リンク切れがない（`npm run preview` で全ページ200応答を確認）
- [x] 404ページが機能する
- [x] title・descriptionがページごとに重複していない
- [x] canonical・OGPが正しく設定されている
- [x] `sitemap-index.xml` が生成される（下書き・準備中ページは除外済み）
- [x] `robots.txt` が生成される
- [x] 下書きページ（`draft: true`、`published: false`）は個別にnoindexのままである（内容充実まで意図的に非公開）
- [x] 正式公開に伴い `allowIndexing: true` に変更済みである
- [x] 未設定のSNSボタンが表示されていない
- [x] 画像にalt属性が設定されている
- [x] 個人情報がGitHubリポジトリに含まれていない（原文アンケートデータ自体を保存しない設計）
- [x] アンケートの原文が公開されていない
- [x] AI分析が初期状態（`aiAnalysisEnabled: false`）である
- [ ] プライバシーポリシー・サイト利用についての制定日が確定している（現在TODO）
- [x] 発信者情報（団体名・連絡先）がフッターとお問い合わせページに明記されている
- [x] 公的機関の公式サイトと誤認されないデザインになっている（フッターに注記あり）
- [x] [Lighthouse](https://developer.chrome.com/docs/lighthouse/overview/)を実行した（結果は下記「Lighthouse実行結果」参照。数値は環境により変動するため保証はしません）
- [x] Cloudflare Pagesへ公開できる状態である（`dist/` 静的出力、`_headers` 設定済み）
- [ ] [23. 公職選挙法上の確認が必要な項目](#23-公職選挙法上の確認が必要な項目)を専門家に確認した

---

## 25. 動画（YouTube）を追加する方法

`src/data/videos.ts` を開き、`videos` 配列にオブジェクトを1件追加してください。

```ts
export const videos: VideoItem[] = [
  {
    id: "video-001",
    youtubeId: "YouTube動画のID（URLの watch?v= の後ろの部分）",
    title: "動画タイトル",
    description: "動画の説明",
    publishedAt: "2026-07-17",
    category: "activity", // "message" | "activity" | "policy" | "shorts" | "other"
    featured: true, // トップページの「注目の動画」に表示する場合はtrue
  },
];
```

- 動画は `/videos` ページに自動的に一覧表示されます。1件も登録されていない間は「動画を準備しています」という案内が表示されます。
- `featured: true` を付けた動画（最大3件）は、トップページ下部の「注目の動画」セクションに自動的に表示されます。動画が0件、またはfeaturedがすべてfalseの間は、このセクション自体が表示されません。
- ヘッダー・フッターの「動画」メニューは、`videos` 配列が1件以上になった時点で自動的に表示されます（`src/data/navigation.ts`）。それまでは既存メニューを圧迫しないよう非表示にしています。
- YouTube動画は `youtube-nocookie.com` のプライバシー強化モードで埋め込まれ、サムネイル＋再生ボタンをクリックするまでiframeを読み込まない軽量な構成です（自動再生はしません）。

**YouTubeチャンネルURLを設定する方法**：`src/data/socialLinks.ts` の `youtube` に入力してください（10・11章のGoogleフォーム・LINE/Instagramと同じ仕組みです）。空欄の間はヘッダー・フッターにYouTubeアイコンは表示されません。

```ts
youtube: "https://www.youtube.com/@xxxxx",
```

### 将来のYouTube Data API連携について（設計メモ）

現時点ではYouTube Data APIは未実装で、動画情報は `src/data/videos.ts` への手動登録のみです。将来、チャンネルの最新動画を自動取得する場合に備えて、動画データの取得（今は手動データを返すだけ）と表示（`VideoCard.astro` / `VideoPlayer.astro` / `/videos` ページ）を分離してあるため、`videos` 配列を返す部分をAPI呼び出しに差し替えるだけで表示側はそのまま使えます。

**重要**：YouTube Data APIキーは、フロントエンドのコードやGitHubリポジトリに直接書き込まないでください。実装する際は、Cloudflare Pages Functions（`functions/` ディレクトリ）にサーバー側の取得処理を置き、APIキーはCloudflare Pagesの環境変数（シークレット）として設定する構成を想定しています。

---

## Lighthouse実行結果（開発環境での参考値）

Microsoft Edge（headless）を使用し、`npm run preview` で起動したビルド済みサイトに対してデスクトッププリセットで計測しました。実際の数値は実行環境・ネットワーク状況により変動するため、目安としてご利用ください。

| ページ | Performance | Accessibility | Best Practices | SEO |
|---|---|---|---|---|
| ホーム（`/`） | 100 | 100 | 100 | 69 |
| 私たちの提言（`/vision`） | 100 | 100 | 100 | 66 |

**SEOスコアについて**：計測時点では `allowIndexing: false` により全ページを意図的にnoindexにしていたため「Page is blocked from indexing」の指摘で69/66点でした（不具合ではありません）。正式公開に伴い `allowIndexing` は `true` に変更済みのため、次回計測時にはこの減点は解消される見込みです（下書き中の`/issues/*`ページ、`/voices/submit`、`/404`は内容確定まで引き続き個別にnoindexです）。

**Accessibilityスコアについて**：初回計測時にボタン・リンク・バッジ等の文字色コントラスト不足（WCAG AA基準未達）が10箇所以上検出されたため、配色を調整し100/100まで改善しました。具体的には、小さな文字やバッジには常に読みやすい濃い文字色（`text-ink`）を使用し、オレンジ・緑・ピンクなどのアクセントカラーは背景の帯やアイコンなど「文字以外」の部分で表現する方針に統一しています。

---

## 既知の脆弱性について（npm audit）

`npm audit` で、Astro 7.0.0未満に存在するXSS/SSRFに関する脆弱性情報（Advisory）が高リスクとして1件検出されます（依存する esbuild の脆弱性を含む）。

**対応方針**：本サイトは `output: "static"` の完全な静的サイトであり、SSR（サーバーサイドレンダリング）やServer Islandsを一切使用していません。該当する脆弱性は、SSRのリクエスト処理時（不正なスロット名・Hostヘッダー等）や `astro dev` の開発サーバー実行時に関わるものが中心で、静的ビルド後の公開ファイルには影響しません。

また、修正版（Astro 7系）は本サイトが使用する `@astrojs/tailwind` が現時点で未対応（peer dependencyが `^5.0.0` まで）のため、アップグレードするとTailwind CSSの統合が壊れてしまいます。

以上を踏まえ、今回はAstro 5.18.2を維持しています。`@astrojs/tailwind`がAstro 7に対応した際、またはTailwind CSS v4（`@tailwindcss/vite`）への移行と合わせて、将来的にアップグレードを検討してください。
