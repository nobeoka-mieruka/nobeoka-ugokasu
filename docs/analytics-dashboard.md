# 執行部ポータル「アクセス解析」（/staff/analytics/）

ホームページの閲覧状況と、申込フォームを開くボタンなどのクリック数を、執行部ポータルで確認できる画面です。
数値は Googleアナリティクス4（GA4）から読み込みます。**GA4から取得した実データだけを表示し、見本の数値や推定値は表示しません。**

- 画面：/staff/analytics/（ログイン必須。ポータルのナビ「アクセス解析」）
- API：GET /staff/api/analytics（`functions/staff/api/analytics.ts`。権限 `analytics:read`）
- GA4の読み取り：`server/ga4Analytics.ts`
- 計測（ブラウザ側）：`src/scripts/analyticsBootstrap.ts`・`src/utils/analytics.ts`
- 中継（Cloud Run・秘密鍵なし）：`services/ga4-proxy`（`server/ga4Proxy.ts` から署名付きで呼ぶ）
- テスト：`npm run test:analytics`・`npm run test:ga4-proxy`

## 画面で見られること

| 項目 | 内容 |
|---|---|
| 集計期間 | 今日／過去7日／過去30日／過去90日／期間指定（最大400日）。過去N日は**昨日まで**の集計（日本時間） |
| 合計と前期間比 | 表示回数・ユーザー数・訪問数（セッション）。前期間は「直前の同じ日数」（例：過去7日なら、その前の7日間） |
| 日別の推移 | 日別の表示回数のグラフ（「表で見る」で数値も確認できます） |
| ページ | まとまりごとの表示回数（トップ／福富千恵について／活動報告／意見交換会／みんなの声／みんなの声ポスト／後援会入会案内／その他）と、上位20ページ |
| 流入元 | 自然検索／SNS／外部サイト／直接アクセス／その他（GA4の「デフォルト チャネル グループ」を分類） |
| 端末 | スマートフォン／パソコン／タブレット |
| ボタンのクリック | 下の「イベント一覧」のイベント × 設置場所（content_type） |
| 申込への遷移（参考） | ボタンのクリック数 ÷ ページの表示回数 × 100 |
| 最終データ更新日時 | GA4からデータを読み込んだ日時 |
| CSV | 表示中の内容をCSV（UTF-8・BOM付き。Excelでそのまま開けます）でダウンロード |

### 申込への遷移（参考）について

- 「申込フォームを開くボタンが押された回数 ÷ そのページの表示回数」です。**申込が完了した割合（申込完了率）ではありません。**
- 同じ人が何度押しても、その回数だけ数えます。表示回数が0のときは「—」と表示します。
- Googleフォームの回答数はホームページと連携していないため、常に「未連携」と表示します（回答数はGoogleフォームの「回答」タブで確認してください）。

| ページ | 数えるボタン（イベント） |
|---|---|
| /dialogue/ | `welfare_apply_click` ＋ `dialogue_apply_click` |
| /voices/submit/ | `voices_form_click`（名称変更前の `voice_form_click` も合算） |
| /voice-post/ | `voice_post_click` |
| /supporters/join/ | `supporter_join_click` |

### データの更新

- 取得結果は1時間（「今日」は15分）保存し、その間はGA4へ問い合わせません（KV `SOCIAL_POSTS_KV` のキー `ga4-analytics:report:v1:…`）。
- GA4側の集計にも数時間かかることがあります。直近の数値は少なめに表示されることがあります。

## イベント一覧（GA4に送るクリックの計測）

1回のクリックで送るイベントは1件だけです。ボタンに `data-track` 属性があるときはそのイベントだけを送り、URLによる自動計測は行いません（`src/scripts/analyticsBootstrap.ts`）。

| イベント名 | 押された場所 | content_type（設置場所） |
|---|---|---|
| `welfare_apply_click` | /dialogue/ 「福祉の現場の声を聴く 意見交換会」の参加申込ボタン | `top`（上部）／`bottom`（下部） |
| `dialogue_apply_click` | /dialogue/ 「意見交換会 参加申込」欄の「申込フォームを開く」（福祉・地域の意見交換会で共通の申込フォーム） | `form_section` |
| `voices_form_click` | /voices/submit/ の「意見を送る（Googleフォーム）」 | `general`（上）／`general_bottom`（下） |
| `voices_form_click` | 上記以外で一般用の意見フォームへのリンク（お問い合わせ・テーマ別ページなど。自動計測） | なし |
| `voice_post_click` | /voice-post/ のフォームを開くボタン | `top`／`bottom` |
| `supporter_join_click` | /supporters/join/ の入会申込フォームを開くボタン・リンク | `intro`（ページ上部）／`form_area`（規約に同意した後のフォーム欄）／`fallback_link`（「こちらから入会申込フォームを開いてください」） |
| `voices_entry_click` | /voices/ の2つの窓口カード（ページの移動） | `general`／`welfare` |
| `news_detail_click` | お知らせカードから詳細への移動 | `internal`／`external` |
| `activity_read_more` | 活動報告の「続きを読む」 | なし |
| `supporter_rules_open` | 後援会規約（PDF）を開く（自動計測） | なし |
| `facebook_click`／`instagram_click` | Facebook・Instagramへのリンク（自動計測） | なし |
| `contact_click` | メールアドレスのリンク（自動計測） | なし |

- 送るパラメータは `link_url`（リンク先）・`link_text`・`content_type` などの許可リストの項目だけです（`src/utils/analytics.ts`）。
- **氏名・連絡先・フォームの入力内容・回答内容は送りません。** フォームの送信完了も計測していません（Googleフォームの中は計測できないため）。
- 旧イベント名：`voice_form_click`（現在の `voices_form_click`）。福祉の意見交換会の申込ボタンは、以前は `dialogue_apply_click`（`top`／`bottom`）として送っていました。名称変更前の期間を見るときはご注意ください。

## 設定手順（管理者）

設定が済むまで、画面には設定手順だけを表示し、数値は表示しません。

### 1. GA4：設置場所（content_type）をカスタムディメンションに登録する

1. GA4 の「管理」→「データの表示」→「カスタム定義」→「カスタムディメンションを作成」。
2. ディメンション名：`設置場所`（任意）／範囲：**イベント**／イベントパラメータ：`content_type` を入力して保存。
3. 登録した後のクリックから、設置場所の内訳が表示されます（登録前のデータには付きません）。未登録の間は「設置場所の内訳は未設定」と表示し、イベント名ごとの合計だけを表示します。

### 2. GA4：プロパティIDを確認する

- GA4 の「管理」→「プロパティ」→「プロパティの詳細」の右上にある**数字だけのプロパティID**（例：`123456789`）。
- `G-` で始まる「測定ID」（`src/config/seoConfig.ts` の `ga4Id`）とは別の値です。測定IDを登録すると、画面に注意が表示されます。

### 3. Google Cloud：サービスアカウントを用意する（JSONキーは作らない）

1. 「APIとサービス」→「ライブラリ」で **Google Analytics Data API** を有効にする。
2. 「IAMと管理」→「サービスアカウント」でサービスアカウントを作る。**プロジェクトへのロール（役割）は付けません。**
3. **JSONキーは作りません。** 後援会のプロジェクトでは、親組織の組織ポリシー（`iam.disableServiceAccountKeyCreation`）により作成できず、作る必要もありません。

### 4. GA4：サービスアカウントを「閲覧者」として追加する

- GA4 の「管理」→「プロパティ」→「プロパティのアクセス管理」→「＋」→「ユーザーを追加」。
- サービスアカウントのメールアドレス（`…@….iam.gserviceaccount.com`）を入力し、役割は **閲覧者** を選ぶ（通知メールのチェックは外してかまいません）。

### 5. Cloud Run：中継をデプロイし、Cloudflare Pages に登録する

GA4 は、Cloud Run で動かす小さな中継（`services/ga4-proxy`）が、手順3のサービスアカウントの権限で読みます（鍵なし）。
Cloudflare からは、共有のシークレットで署名した要求だけを受け付けます。手順・必要な権限・費用・安全のための仕組みは **`services/ga4-proxy/README.md`** にまとめています。

1. 中継を Cloud Run にデプロイする（署名用のシークレットは Secret Manager に保存）。
2. Cloudflare ダッシュボード → Workers & Pages → このサイトのプロジェクト → 「設定」→「変数とシークレット」→ **本番環境（Production）** に、3つとも種類「**シークレット（暗号化）**」で追加し、**再デプロイ**する。

| 名前 | 値 |
|---|---|
| `GA4_PROPERTY_ID` | 手順2の数字のプロパティID |
| `GA4_PROXY_URL` | 中継の URL（`https://ga4-proxy-….a.run.app`。https のみ） |
| `GA4_PROXY_SECRET` | Secret Manager の `ga4-proxy-hmac` と同じ値（32文字以上） |

- 値をコード・GitHub・チャットに貼り付けないでください。
- プレビュー環境には登録しません（プレビューのポータルでは設定手順が表示されます）。
- `GA4_PROXY_URL`・`GA4_PROXY_SECRET` のどちらかが登録されていると中継方式になります。片方だけ・形式が違うときは、数値を出さずに設定手順と注意を表示します。
- **Google Cloud の無料トライアル（2026年12月31日終了）について：** 有料アカウントにアップグレードしない場合、終了と同時に中継が止まり、画面は「データは未取得です」になります（数値は推定・表示しません）。/staff/analytics/ に終了日と残り日数を案内します。設定は `src/config/analyticsRelayConfig.ts`（切り替えたら `plan` を `"paid"` に）。詳しくは `services/ga4-proxy/README.md`。

#### 参考：鍵方式（従来。鍵を作れる環境だけ）

中継の値が無いときは、従来どおり `GA4_SERVICE_ACCOUNT_EMAIL`（JSONキーの `client_email`）と `GA4_SERVICE_ACCOUNT_PRIVATE_KEY`（`private_key`）で接続します。
後援会のプロジェクトでは組織ポリシーにより鍵を作れないため、この方式は使いません。

### 6. 確認

- /staff/analytics/ を開き、「過去7日」の数値が GA4 の「レポート」の同じ期間とおおむね一致することを確認します（GA4の画面とはしきい値・集計方法の違いで少しずれることがあります）。
- 「データは未取得です」と表示される場合：サービスアカウントが GA4 の閲覧者になっているか、Data API が有効か、3つの値が正しいか、中継が動いているかを確認してください。サーバーのログには `ga4-analytics-error` とエラーの種類（`proxy_rejected`＝シークレットの不一致、`api_forbidden`＝GA4の権限、`rate_limited`、`network_error`＝中継に接続できない、など）だけが記録されます。

## 計測の確認（GA4 DebugView）

- 計測タグ（gtag.js）は**本番のホストでだけ**読み込みます（localhost・プレビューデプロイでは読み込みません）。そのため、DebugView での確認は本番サイトで行います。
- 手順：Chrome に拡張機能「Google Analytics Debugger」を入れて有効にする → 本番サイトでボタンを押す → GA4 の「管理」→「DebugView」で、イベント名と `content_type` を確認する。
- プライバシーポリシー（/privacy/）でアクセス解析を無効にしている端末では送信されません。確認前に「有効」になっていることを確かめてください。
- 申込フォームのボタンを押すと、Googleフォームが新しいタブで開きます（確認のために回答を送信する必要はありません）。

## プライバシー

- 計測するのは、閲覧したページ・端末・流入元などの一般的な情報と、どのボタンが・どの場所で押されたかだけです。氏名・連絡先・フォームの入力内容は送りません（/privacy/ に記載）。
- 広告向けの信号連携（Googleシグナル）・広告のパーソナライズは無効にしています。
- 訪問者は /privacy/ でアクセス解析を無効にできます。
- ポータルの画面（/staff/）では GA4 を読み込みません。アクセス解析の画面とAPIはログインした執行部だけが使えます。
- サービスアカウントは GA4 の「閲覧者」（読み取りのみ）で、データの変更はできません。秘密鍵は作りません。中継が Cloud Run のサービスアカウントの権限で読み、Cloudflare との間は署名用のシークレット（Secret Manager と Cloudflare の暗号化シークレットにだけ保存）で認証します。シークレット・アクセストークン・Google のエラー内容は、ブラウザ・ログ・キャッシュには出しません。
- 少ない件数の数値を外部へ公表する場合は、個人が推測されないかを確認してから公表してください。
