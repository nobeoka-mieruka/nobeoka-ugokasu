# Facebook・Instagram自動連携の設定方法

> **最新の手順・変数名の一覧は、プロジェクト直下の [META_SOCIAL_SETUP.md](../META_SOCIAL_SETUP.md) にまとめています。** このページはMeta側の管理画面の操作を中心とした詳しい補足資料として残しています。

このページでは、「福富千恵と延岡を動かす会」のFacebookページとInstagramの投稿を、公式ホームページの「活動報告」ページへ自動的に反映させるための設定方法を説明します。

エンジニアでない方でも作業できるように、できるだけ分かりやすく書いています。ただし、Meta（Facebook・Instagramの運営会社）の管理画面やAPIの仕様は時々変更されます。この文書に書かれている「メニュー名」や「ボタンの位置」が実際の画面と違う場合は、Meta for Developersの公式ヘルプで最新の手順を確認してください。

---

## 目次

1. [Facebookページを作る方法](#1-facebookページを作る方法)
2. [Instagramをプロアカウントにする方法](#2-instagramをプロアカウントにする方法)
3. [FacebookページとInstagramを接続する方法](#3-facebookページとinstagramを接続する方法)
4. [Meta開発者アプリを作成する方法](#4-meta開発者アプリを作成する方法)
5. [必要な権限](#5-必要な権限)
6. [FacebookページIDの確認方法](#6-facebookページidの確認方法)
7. [InstagramアカウントIDの確認方法](#7-instagramアカウントidの確認方法)
8. [アクセストークンの取得・更新方法](#8-アクセストークンの取得更新方法)
9. [Cloudflare Secretsへの登録場所](#9-cloudflare-secretsへの登録場所)
10. [Cron Triggerの設定方法](#10-cron-triggerの設定方法)
11. [手動同期の実行方法](#11-手動同期の実行方法)
12. [トークン期限切れ時の復旧方法](#12-トークン期限切れ時の復旧方法)

---

## この仕組みの全体像

```
Facebookページ / Instagram（投稿）
        ↓ Meta Graph API（10分ごとに取得）
Cloudflare Worker（worker/social-sync.ts）
        ↓ 結果を保存
Cloudflare KV（キャッシュ）
        ↓ 読み込み
Cloudflare Pages Functions（functions/api/social-posts.ts）
        ↓ ブラウザがfetchで取得
ホームページの「活動報告」ページ
```

アクセストークン（合言葉のようなもの）は、Cloudflareの「Secrets」という暗号化された場所にだけ保存します。GitHubやホームページのプログラムファイルには一切書き込みません。

---

## 1. Facebookページを作る方法

「福富千恵と延岡を動かす会」の活動を発信するための**Facebookページ**（個人アカウントとは別の、団体・お店などが作る公開ページ）を用意します。

1. Facebookに個人アカウントでログインする
2. 画面のメニューから「ページを作成」を選ぶ
3. ページ名に「福富千恵と延岡を動かす会」など、正式名称を入力する
4. カテゴリ（政治団体、地域団体など、実態に合うもの）を選ぶ
5. 案内に沿ってプロフィール画像・カバー画像を設定する

**すでに福富千恵さん個人のFacebookアカウントがある場合でも、そのアカウントの投稿を直接取得することはできません。** 必ず団体として管理する「Facebookページ」を別途作成し、そちらに活動報告を投稿してください。

---

## 2. Instagramをプロアカウントにする方法

InstagramのAPIで投稿を取得するには、通常の個人アカウントではなく「プロアカウント（ビジネスまたはクリエイター）」にする必要があります。

1. Instagramアプリで対象のアカウント（例：`chie_smily4`）を開く
2. 設定 → アカウントの種類とツール（表記はアプリのバージョンにより多少異なります）
3. 「プロアカウントに切り替える」を選ぶ
4. 「クリエイター」または「ビジネス」を選ぶ（どちらでもAPIでの取得は可能です）
5. カテゴリを選び、案内に沿って設定を完了する

---

## 3. FacebookページとInstagramを接続する方法

Instagramのプロアカウントは、1で作成したFacebookページと連携させる必要があります（Meta Graph APIはFacebookページ経由でInstagramのデータにアクセスする仕組みのためです）。

1. Instagramアプリの設定から「アカウントセンター」（または「リンク済みアカウント」）を開く
2. 「Facebookとの連携」からFacebookページを選択して接続する
3. 接続が完了すると、Facebookページの設定画面からもInstagramアカウントが確認できるようになります

---

## 4. Meta開発者アプリを作成する方法

Graph APIを使うには、Meta for Developersで「アプリ」を1つ作成する必要があります。

1. [Meta for Developers](https://developers.facebook.com/) に、Facebookページを管理しているアカウントでログインする
2. 「アプリを作成」を選ぶ
3. アプリの種類は「ビジネス」を選ぶ
4. アプリ名（例：「福富千恵と延岡を動かす会 サイト連携」）を入力して作成する
5. 作成後の管理画面で、「製品を追加」から次を追加する
   - **Facebookログイン**（アクセストークンを発行するために使用）
   - 必要に応じて「Instagramグラフ API」

画面構成はMetaの仕様変更で今後も変わる可能性があります。「Graph API Explorer」というツール（開発者アプリの管理画面、または https://developers.facebook.com/tools/explorer/ ）から権限付きのトークンを発行する方法が、現時点では最も分かりやすい方法です。

---

## 5. 必要な権限

アクセストークンを発行する際、次の権限（パーミッション）を許可してください。

| 権限名 | 用途 |
|---|---|
| `pages_show_list` | 管理しているFacebookページの一覧を取得する |
| `pages_read_engagement` | Facebookページの投稿内容を読み取る |
| `pages_read_user_content` | Facebookページの投稿本文・画像等を読み取る |
| `instagram_basic` | Instagramのプロフィール・メディア基本情報を読み取る |
| `instagram_manage_insights` | 一部の環境でInstagramメディア取得に必要になる場合があります |

権限名は将来変更される可能性があります。Graph API Explorerの権限選択画面で「ページ」「Instagram」に関する読み取り系の権限を確認しながら選んでください。

---

## 6. FacebookページIDの確認方法

1. 管理しているFacebookページを開く
2. 「プロフィールを編集」または「ページの詳細情報」を開く
3. 「ページID」という項目に数字が表示されています（例：`123456789012345`）

または、Graph API Explorerで `me/accounts` を実行すると、管理しているページの一覧とIDが表示されます。

この値を `FACEBOOK_PAGE_ID` として登録します。

---

## 7. InstagramアカウントIDの確認方法

InstagramのIDは、Instagramアプリの「ユーザーネーム」（例：`chie_smily4`）とは別の、Graph API用の数字のIDです。

1. Graph API Explorerで、接続したFacebookページのアクセストークンを選ぶ
2. `me/accounts` を実行し、対象ページの `id` を確認する
3. そのページIDを使って `{ページID}?fields=instagram_business_account` を実行する
4. 結果に表示される `instagram_business_account.id` の数字が、InstagramユーザーIDです

この値を `INSTAGRAM_USER_ID` として登録します。**Instagramのユーザーネーム（例：`chie_smily4`）とは全く別の値であり、ユーザーネームから推測することはできません。** 必ずこの手順で確認した数字のIDを使ってください。

---

## 8. アクセストークンの取得・更新方法

1. Graph API Explorerで、対象のアプリ・Facebookページを選択する
2. 5で確認した権限をすべてチェックする
3. 「Generate Access Token」（アクセストークンを生成）を押す
4. 表示されたトークンをコピーする

**注意：Graph API Explorerで発行される初期のトークンは有効期限が短い（数時間〜数日）場合があります。** 運用では、次のいずれかの方法で「長期トークン（60日間程度）」に交換してから使うことを強くおすすめします。

- Meta for Developersの「アクセストークンデバッガー」ツールで、短期トークンを長期トークンに変換する
- Graph API Explorerのアプリ設定画面にある長期トークン発行の案内に従う

FacebookページのアクセストークンURLは期限切れの概念がない「ページアクセストークン」に変換できる場合があります（長期ユーザートークンを使って `me/accounts` を呼び出すと、有効期限のないページトークンが返ってくることがあります）。可能であればこの方式を利用してください。

トークンを取得・更新するたびに、[9. Cloudflare Secretsへの登録場所](#9-cloudflare-secretsへの登録場所)の手順で再登録してください。

---

## 9. Cloudflare Secretsへの登録場所

秘密情報（アクセストークン等）は、**Cloudflare Pages側**と**Cloudflare Worker側**の両方に、それぞれ個別に登録する必要があります（2つの別々の仕組みとして動いているためです）。

### Cloudflare Pages（サイト本体・手動同期API用）

1. Cloudflareダッシュボード → 「Workers & Pages」→ 対象のPagesプロジェクトを開く
2. 「Settings」→「Environment variables」を開く
3. 「Add variable」から、次の名前で値を登録する（本番環境 Production を選択）

   | 変数名 | 種類 |
   |---|---|
   | `META_GRAPH_API_VERSION` | 通常の変数（例：`v21.0`） |
   | `FACEBOOK_PAGE_ID` | 通常の変数 |
   | `FACEBOOK_PAGE_ACCESS_TOKEN` | **Secret（暗号化）** |
   | `INSTAGRAM_USER_ID` | 通常の変数 |
   | `INSTAGRAM_ACCESS_TOKEN` | **Secret（暗号化）** |
   | `SOCIAL_SYNC_SECRET` | **Secret（暗号化）** |
   | `SOCIAL_POST_LIMIT` | 通常の変数（初期値 `6`。1プラットフォームあたりの取得件数） |
   | `FACEBOOK_PAGE_URL` | 通常の変数（公式FacebookページURL。秘密情報ではありません） |
   | `INSTAGRAM_PROFILE_URL` | 通常の変数（公式InstagramプロフィールURL。秘密情報ではありません） |

4. 同じ画面の「KV namespace bindings」（Functionsの設定内）で、`SOCIAL_POSTS_KV` という名前でKV名前空間をバインドする（事前にKV名前空間を作成しておく必要があります。Cloudflareダッシュボードの「Storage & Databases」→「KV」から作成できます）

### Cloudflare Worker（30分ごとの自動同期用）

`worker/` フォルダで、次のコマンドを1つずつ実行します（ターミナル・コマンドプロンプトから）。

```
cd worker
wrangler kv namespace create SOCIAL_POSTS_KV
```

表示された `id` を `worker/wrangler.toml` の `REPLACE_WITH_YOUR_KV_NAMESPACE_ID` の部分に書き込みます。

続けて、秘密情報を登録します（実行するとその場で値の入力を求められます）。

```
wrangler secret put FACEBOOK_PAGE_ID
wrangler secret put FACEBOOK_PAGE_ACCESS_TOKEN
wrangler secret put INSTAGRAM_USER_ID
wrangler secret put INSTAGRAM_ACCESS_TOKEN
wrangler secret put SOCIAL_SYNC_SECRET
```

最後にデプロイします。

```
wrangler deploy
```

---

## 10. Cron Triggerの設定方法

`worker/wrangler.toml` に、すでに次の設定が入っています（10分ごとに自動実行。新しい投稿が遅くとも15分程度でホームページへ反映されることを目安にしています）。

```toml
[triggers]
crons = ["*/10 * * * *"]
```

`wrangler deploy` を実行すると、この設定も一緒にCloudflareへ反映されます。実行状況は、Cloudflareダッシュボードの対象Worker →「Triggers」タブ、または「Logs」タブから確認できます。

同期の間隔を変えたい場合は、この`crons`の値を変更してから再度 `wrangler deploy` を実行してください。

---

## 11. 手動同期の実行方法

管理者が今すぐ同期を試したいときは、次のように実行します（`SOCIAL_SYNC_SECRET`に登録した値を使います）。

```bash
curl -X POST https://<あなたのサイトのドメイン>/api/admin/sync-social-posts \
  -H "Authorization: Bearer <SOCIAL_SYNC_SECRETの値>"
```

成功すると、次のような結果が返ります。

```json
{
  "ok": true,
  "facebookFetched": 5,
  "instagramFetched": 8,
  "savedCount": 12,
  "skippedReason": null
}
```

**秘密キーは、URLの一部（クエリパラメータ）に入れないでください。** 上記のように、必ず`Authorization`ヘッダーに入れてください。ブラウザのアドレスバーに直接この操作を行うことはできません（`curl`コマンドや、Postmanのようなツールを使ってください）。

---

## 12. トークン期限切れ時の復旧方法

アクセストークンの有効期限が切れると、同期が失敗するようになります。ただし、**それまでに正常に取得できていた投稿はキャッシュに残ったまま表示され続けるため、サイトが急に空白になることはありません。**

復旧の手順は次のとおりです。

1. Cloudflareダッシュボードで、対象Worker（または Pages プロジェクト）の「Logs」を確認し、`facebookError` または `instagramError` にエラーが出ていないか確認する
2. [8. アクセストークンの取得・更新方法](#8-アクセストークンの取得更新方法)の手順で、新しいアクセストークンを発行する
3. [9. Cloudflare Secretsへの登録場所](#9-cloudflare-secretsへの登録場所)の手順で、Pages側・Worker側の両方のシークレットを新しい値に上書きする
4. [11. 手動同期の実行方法](#11-手動同期の実行方法)の手順で、手動同期を実行して正常に復旧したか確認する

長期的には、有効期限のない「ページアクセストークン」を利用する方法（8章参照）にしておくと、更新の手間を減らせます。

---

## うまく表示されないときの確認方法

- ブラウザで `https://<サイトのドメイン>/api/social-posts` を直接開き、`posts` に投稿が入っているか確認する
- 空の場合は、Cloudflare側のログで同期エラーがないか確認する（アクセストークンや内部IDはログに出力されません）
- Facebookの投稿が「公開」設定になっているか確認する（非公開・友達限定の投稿は取得できません）
- Instagramの投稿が「ストーリーズ」ではなく、通常の投稿・リール・カルーセルであるか確認する（ストーリーズは仕様上、対象外です）
