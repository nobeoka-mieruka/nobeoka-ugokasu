# Meta（Facebook・Instagram）連携 設定手順書

このドキュメントは、「福富千恵と延岡を動かす会」公式ホームページの活動報告ページに、FacebookページとInstagramの投稿を自動的に反映させるための設定手順です。

対象アカウント：

- Facebookページ：https://www.facebook.com/profile.php?id=61591967011155
- Instagram：https://www.instagram.com/chie_smily4/（ユーザーネーム：`chie_smily4`）

**重要：** Meta（Facebook・Instagramの運営会社）の管理画面・メニュー名・APIの仕様は随時変更されます。この手順書に書かれている「メニュー名」や「ボタンの位置」が実際の画面と異なる場合は、必ず [Meta for Developers](https://developers.facebook.com/) の公式ドキュメントで実装時点の最新の手順を確認してください。この手順書には、実在するID・アクセストークンの値は一切記載していません（記載できません）。すべてMeta側の管理画面で実際に確認・発行した値を使ってください。

コード側の実装状況について：プログラムの実装（Cloudflare Pages Functions・Cloudflare KVキャッシュ・自動同期Worker・活動報告ページのカード表示）はすでに完了しています。**残っているのは、この手順書に沿ったMeta側でのID確認・アクセストークン発行と、Cloudflareへの登録作業のみです。**

---

## 目次

1. [Instagramをプロアカウントにする方法](#1-instagramをプロアカウントにする方法)
2. [InstagramとFacebookページをMeta側で接続する必要性](#2-instagramとfacebookページをmeta側で接続する必要性)
3. [Metaアプリ作成で必要な作業](#3-metaアプリ作成で必要な作業)
4. [FacebookページIDの確認方法](#4-facebookページidの確認方法)
5. [InstagramユーザーIDの確認方法](#5-instagramユーザーidの確認方法)
6. [必要な権限とアクセストークン取得の流れ](#6-必要な権限とアクセストークン取得の流れ)
7. [長期利用できるトークンまたはページアクセストークンの設定方法](#7-長期利用できるトークンまたはページアクセストークンの設定方法)
8. [Cloudflare PagesへのVariablesとSecrets登録方法](#8-cloudflare-pagesへのvariablesとsecrets登録方法)
9. [ProductionとPreviewの両方を設定する場合の注意](#9-productionとpreviewの両方を設定する場合の注意)
10. [設定後に再デプロイが必要なこと](#10-設定後に再デプロイが必要なこと)
11. [ローカル確認方法](#11-ローカル確認方法)
12. [本番確認方法](#12-本番確認方法)
13. [トークン期限切れ時の更新方法](#13-トークン期限切れ時の更新方法)
14. [投稿が表示されない場合の確認項目](#14-投稿が表示されない場合の確認項目)

---

## 1. Instagramをプロアカウントにする方法

Meta Graph APIで投稿を取得するには、Instagramアカウントが通常の個人アカウントではなく「プロアカウント（ビジネスまたはクリエイター）」である必要があります。

1. Instagramアプリで `chie_smily4` を開く
2. 設定 →「アカウントの種類とツール」（アプリのバージョンにより表記が多少異なります）
3. 「プロアカウントに切り替える」を選ぶ
4. 「ビジネス」または「クリエイター」を選ぶ（どちらでもAPI取得は可能）
5. 案内に沿ってカテゴリ等を設定する

---

## 2. InstagramとFacebookページをMeta側で接続する必要性

Meta Graph APIは、Instagramのプロアカウントに**Facebookページ経由**でアクセスする仕組みです。そのため、`chie_smily4` のプロアカウントを、対象のFacebookページ（https://www.facebook.com/profile.php?id=61591967011155 ）と接続しておく必要があります。

1. Instagramアプリの設定 →「アカウントセンター」（または「リンク済みアカウント」）を開く
2. 「Facebookとの連携」から対象のFacebookページを選択して接続する
3. 接続後は、Facebookページの管理画面からもInstagramアカウントが確認できるようになります

接続されていない場合、後述の「InstagramユーザーIDの確認方法」でIDが取得できません。

---

## 3. Metaアプリ作成で必要な作業

Graph APIを呼び出すには、Meta for Developersで「アプリ」を1つ作成する必要があります。

1. [Meta for Developers](https://developers.facebook.com/) に、Facebookページを管理しているアカウントでログインする
2. 「アプリを作成」→ アプリの種類は「ビジネス」を選ぶ
3. アプリ名（例：「福富千恵と延岡を動かす会 サイト連携」）を入力して作成する
4. 作成後の管理画面で、「製品を追加」から次を追加する
   - **Facebookログイン**（アクセストークン発行に使用）
   - 必要に応じて「Instagramグラフ API」

「Graph API Explorer」（アプリの管理画面内、または https://developers.facebook.com/tools/explorer/ ）から、権限付きのトークンを発行できます。画面構成は変更される可能性があるため、実装時点の公式ヘルプもあわせて確認してください。

---

## 4. FacebookページIDの確認方法

1. 対象のFacebookページを開く →「プロフィールを編集」または「ページの詳細情報」
2. 「ページID」に数字が表示されます（例：`123456789012345`）

または、Graph API Explorerで `me/accounts` を実行すると、管理しているページの一覧とIDが確認できます。

この値を環境変数 **`FACEBOOK_PAGE_ID`** に設定します。

**注意：** プロフィールURL中の `61591967011155` はページID「らしき」数字ですが、これはURLの一部から読み取れる値であり、Meta APIで正式に確認したIDと必ず一致するとは限りません。**上記の手順で確認した値を、推測せずにそのまま使用してください。**

---

## 5. InstagramユーザーIDの確認方法

InstagramのユーザーID（Graph API用の数字のID）は、Instagramの**ユーザーネーム**（`chie_smily4`）とは全く別の値です。**ユーザーネームからこのIDを推測することはできません。** 必ず以下の手順でMeta側から確認してください。

1. Graph API Explorerで、2で接続したFacebookページのアクセストークンを選択する
2. `me/accounts` を実行し、対象ページの `id` を確認する
3. そのページIDを使って `{ページID}?fields=instagram_business_account` を実行する
4. 結果に表示される `instagram_business_account.id` の数字が、InstagramユーザーIDです

この値を環境変数 **`INSTAGRAM_USER_ID`** に設定します。

---

## 6. 必要な権限とアクセストークン取得の流れ

アクセストークンを発行する際、次の権限（パーミッション）を許可してください（権限名はMetaの仕様変更で今後変わる可能性があります）。

| 権限名 | 用途 |
|---|---|
| `pages_show_list` | 管理しているFacebookページの一覧を取得する |
| `pages_read_engagement` | Facebookページの投稿内容を読み取る |
| `pages_read_user_content` | Facebookページの投稿本文・画像等を読み取る |
| `instagram_basic` | Instagramのプロフィール・メディア基本情報を読み取る |
| `instagram_manage_insights` | 一部の環境でInstagramメディア取得に必要になる場合がある |

取得の流れ：

1. Graph API Explorerで、対象のアプリ・Facebookページを選択する
2. 上記の権限をすべてチェックする
3. 「Generate Access Token」を押し、表示されたトークンをコピーする

この時点のトークンは有効期限が短い（数時間〜数日）ことが多いため、次章の手順で長期化してから利用してください。

---

## 7. 長期利用できるトークンまたはページアクセストークンの設定方法

短期トークンをそのまま使うと、数日でSNS連携が停止してしまいます。次のいずれかの方法で「長期トークン」に交換してください。

- Meta for Developersの「アクセストークンデバッガー」ツールで、短期トークンを長期トークン（60日間程度）に変換する
- 長期ユーザートークンを使って `me/accounts` を呼び出すと、**有効期限のないページアクセストークン**が返ってくる場合があります。可能であればこの方式を強く推奨します（8章以降の更新作業が不要になるため）

トークンが決まったら、環境変数 **`FACEBOOK_PAGE_ACCESS_TOKEN`**（Facebook用）・**`INSTAGRAM_ACCESS_TOKEN`**（Instagram用）として、次章の手順でCloudflareへ登録します。

**このトークンは、Reactコード・`.env`ファイル・GitHub・READMEなど、リポジトリ内のどこにも書き込まないでください。** 登録先はCloudflareの「Secrets」のみです。

---

## 8. Cloudflare PagesへのVariablesとSecrets登録方法

このサイトはCloudflare Pagesで公開されています。管理画面から、通常の環境変数（Variables）とSecretsをそれぞれ登録します。

1. Cloudflareダッシュボード →「Workers & Pages」→ 対象のPagesプロジェクトを開く
2. 「Settings」→「Environment variables」（または「Variables and Secrets」）を開く
3. 次の値を登録する

   **通常の環境変数（Variables）：**

   | 変数名 | 値の例 |
   |---|---|
   | `META_GRAPH_API_VERSION` | `v21.0`（実装時点の最新版はMeta公式ドキュメントで確認） |
   | `FACEBOOK_PAGE_ID` | 4章で確認した数字のID |
   | `INSTAGRAM_USER_ID` | 5章で確認した数字のID |
   | `FACEBOOK_PAGE_URL` | `https://www.facebook.com/profile.php?id=61591967011155` |
   | `INSTAGRAM_PROFILE_URL` | `https://www.instagram.com/chie_smily4/` |

   **Secrets（暗号化。値は画面上でも再表示されません）：**

   | 変数名 | 値 |
   |---|---|
   | `FACEBOOK_PAGE_ACCESS_TOKEN` | 7章で用意したFacebookページアクセストークン |
   | `INSTAGRAM_ACCESS_TOKEN` | 7章で用意したInstagram用アクセストークン |
   | `SOCIAL_SYNC_SECRET` | 手動同期エンドポイント保護用に自分で決めた合言葉（英数字20文字程度を推奨） |

4. 同じ設定画面の「KV namespace bindings」（Functionsの設定内）で、`SOCIAL_POSTS_KV` という名前でKV名前空間をバインドする（事前に Storage & Databases →「KV」から作成しておく）

5. `worker/` フォルダの自動同期Worker（10分ごとのCron実行用）には、Pagesとは別に、次のコマンドで同じ内容を登録する

   ```
   cd worker
   wrangler kv namespace create SOCIAL_POSTS_KV   # 初回のみ。idをwrangler.tomlに反映する
   wrangler secret put FACEBOOK_PAGE_ID
   wrangler secret put FACEBOOK_PAGE_ACCESS_TOKEN
   wrangler secret put INSTAGRAM_USER_ID
   wrangler secret put INSTAGRAM_ACCESS_TOKEN
   wrangler secret put SOCIAL_SYNC_SECRET
   wrangler deploy
   ```

**アクセストークンは、Pages側・Worker側の2箇所どちらにも登録が必要です（別々の仕組みとして動くため）。**

---

## 9. ProductionとPreviewの両方を設定する場合の注意

Cloudflare Pagesの環境変数は、**Production環境**と**Preview環境（プルリクエストごとのプレビューデプロイ）**で別々に設定できます。

- 最低限、**Production環境**には必ず全ての値を登録してください
- Preview環境でもSNS連携を確認したい場合は、同じ値をPreview環境にも登録してください（未設定の場合、Preview環境では「API未設定」の案内表示になるだけで、ビルドやサイト全体は壊れません）
- Secretsは環境ごとに個別入力が必要です（Productionへの登録がPreviewへ自動的にコピーされるわけではありません）

---

## 10. 設定後に再デプロイが必要なこと

Cloudflare Pagesの環境変数（Variables・Secretsとも）は、**設定を保存しただけでは既存の公開済みサイトには反映されません。** 次のいずれかの操作で、値を反映した新しいデプロイを作成してください。

- Cloudflareダッシュボードの「Deployments」タブから、最新のデプロイを「Retry deployment」する
- または、リポジトリへ何か変更をコミット・プッシュして新しいビルドを走らせる

Worker側（`worker/`）は `wrangler secret put` の実行と `wrangler deploy` 自体がそのまま反映操作になるため、追加の再デプロイは不要です。

---

## 11. ローカル確認方法

Pages Functions（`/api/social-posts` など）は、`astro dev` だけでは動作を確認できません（Cloudflareの実行環境をエミュレートする必要があるため）。

1. プロジェクト直下の `.dev.vars.example` をコピーして `.dev.vars` を作成し、手元で確認したい値だけ入力する（`.dev.vars` はGit管理対象外です）
2. 次のコマンドを実行する

   ```
   npm run dev:pages
   ```

   これは `npm run build` で静的サイトをビルドしたあと、`wrangler pages dev` でCloudflare Pages Functionsをローカル起動します。

3. ブラウザで表示されたURL（例：`http://localhost:8788`）を開き、`/activities` ページでカード表示を確認する
4. `http://localhost:8788/api/social-posts` を直接開き、JSON応答（`posts` / `status` / `updatedAt`）を確認できます

`.dev.vars` に値を何も入れていない場合でも、エラー画面にはならず「SNSでも活動を発信しています」という案内が表示されれば正常です。

---

## 12. 本番確認方法

1. Cloudflare Pagesの管理画面で、8章の値を登録し、10章の手順で再デプロイする
2. 本番URLの `/activities` を開き、Facebook・Instagramタブそれぞれで実際の投稿がカード表示されることを確認する
3. `https://<本番ドメイン>/api/social-posts` を直接開き、`posts` に投稿が入っているか、`status` が `"ok"` になっているか確認する
4. 管理者用の手動同期エンドポイントで即時反映を確認したい場合（`SOCIAL_SYNC_SECRET` が必要）

   ```bash
   curl -X POST https://<本番ドメイン>/api/admin/sync-social-posts \
     -H "Authorization: Bearer <SOCIAL_SYNC_SECRETの値>"
   ```

5. 自動同期（Cronトリガー）は10分間隔のため、Facebook・Instagramへの新規投稿から遅くとも15分程度で `/activities` へ反映されます

---

## 13. トークン期限切れ時の更新方法

アクセストークンの有効期限が切れると、同期が失敗するようになります。ただし、**それまでに正常に取得できていた投稿はキャッシュに残ったまま表示され続けるため、サイトが急に空白になることはありません。**（片方のSNSだけ失敗した場合も、もう片方は通常どおり表示されます。）

1. Cloudflareダッシュボードで、対象Worker（または Pagesプロジェクト）の「Logs」を確認し、エラーが出ていないか確認する
2. [7章](#7-長期利用できるトークンまたはページアクセストークンの設定方法)の手順で、新しいアクセストークンを発行する
3. [8章](#8-cloudflare-pagesへのvariablesとsecrets登録方法)の手順で、Pages側・Worker側の両方のSecretsを新しい値に上書きする
4. [10章](#10-設定後に再デプロイが必要なこと)の手順で再デプロイ（Worker側は`wrangler secret put`実行時点で反映済み）
5. [12章](#12-本番確認方法)の手動同期エンドポイントで、正常に復旧したか確認する

長期的には、有効期限のない「ページアクセストークン」（7章参照）を利用すると、更新の手間を減らせます。

---

## 14. 投稿が表示されない場合の確認項目

- `https://<ドメイン>/api/social-posts` を直接開き、`posts` に投稿が入っているか、`status.facebook` / `status.instagram` が `"ok"` になっているか確認する（`"not_configured"` の場合はCloudflare側の環境変数が未登録、`"error"` の場合は取得に失敗している状態です。トークンの中身やエラー全文はレスポンスに含まれません）
- Cloudflare側のログで同期エラーが出ていないか確認する
- Facebookの投稿が「公開」設定になっているか確認する（非公開・友達限定の投稿は取得できません。また、来場者がページへ投稿した内容は仕様上取得対象外です）
- Instagramの投稿が「ストーリーズ」ではなく、通常の投稿・リール・カルーセルであるか確認する（ストーリーズは24時間で消えるため対象外です）
- `INSTAGRAM_USER_ID` に、ユーザーネーム（`chie_smily4`という文字列）を誤って入力していないか確認する（数字のIDである必要があります）
- 8章の登録後に、10章の再デプロイを行ったか確認する
- 反映まで最大15分程度かかります。投稿直後に確認した場合は、少し時間を置いてから再確認してください
