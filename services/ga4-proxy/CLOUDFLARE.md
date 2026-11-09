# Cloudflare Pages の設定と、本番接続の確認

`bash scripts/setup.sh` が最後まで成功した後に行います（Cloud Run の URL と、署名用シークレットが必要です）。
Cloudflare には setup.sh から接続しないため、ここだけは管理画面での手作業です。

## 1. Cloudflare Pages に3つ登録する

1. Cloud Shell で `bash scripts/show-secret.sh` を実行し、表示された1行（GA4_PROXY_SECRET の値）をコピーする。
   - 画面共有をしていないことを確認してから実行してください。Enter を押すと画面を消去します。
   - 値はメモ帳・メール・チャット・GitHub に貼り付けないでください。
2. Cloudflare ダッシュボード → **Workers & Pages** → **nobeoka-ugokasu** → **設定** → **変数とシークレット**
3. **本番（Production）** の環境を選び、「追加」で次の3つを、種類 **シークレット（暗号化）** で登録する。

| 名前 | 値 |
|---|---|
| `GA4_PROPERTY_ID` | `546942310` |
| `GA4_PROXY_URL` | setup.sh の最後に表示された Cloud Run の URL（`https://ga4-proxy-….a.run.app`）。`/health-check` などのパスは付けません（付いていても自動で外しますが、ログに `url_path_ignored` が記録されます） |
| `GA4_PROXY_SECRET` | 手順1でコピーした値 |

4. 「保存」したら、**デプロイ** → 最新の本番デプロイの「…」→ **デプロイを再試行**（環境変数は次のデプロイから有効になります）。

注意：

- **既存のシークレット（`GOOGLE_CLIENT_SECRET`・`META_ACCESS_TOKEN`・`NEWS_DETECT_SECRET`・`SOCIAL_CRON_SECRET`・`SOCIAL_SYNC_SECRET`・`STAFF_ALLOWED_EMAILS` など）は変更・削除しないでください。** 追加するのは上の3つだけです。
- プレビュー（Preview）の環境には登録しません（プレビューのポータルは「未設定」の案内のままです）。
- `GA4_SERVICE_ACCOUNT_EMAIL`・`GA4_SERVICE_ACCOUNT_PRIVATE_KEY` は登録しません（鍵方式は使いません）。

## 2. 本番接続の確認

再デプロイが終わったら（数分）、執行部ポータルにログインして確認します。

| 確認すること | 期待する結果 |
|---|---|
| パソコンで /staff/analytics/ を開く | 「アクセス解析はまだ設定されていません」が消え、数値が表示される |
| 「過去7日」「過去30日」「過去90日」 | 表示回数・ユーザー数・訪問数が、setup.sh が表示した「過去7日・30日・90日」の数値と一致する（GA4の集計の更新で少しずれることがあります） |
| ページ | 上位ページが setup.sh の「過去7日の上位ページ」とおおむね一致する |
| ボタンのクリック | 申込ボタンのクリック数が setup.sh の表示と一致する（**申込の完了数ではありません**） |
| GA4 の画面との照合 | GA4 の「レポート」→「エンゲージメント」→「ページとスクリーン」で、同じ期間（昨日まで）の表示回数とおおむね一致する |
| 最終データ更新日時 | 今日の日時が表示される |
| スマートフォンで同じ画面を開く | 表・グラフが画面の幅に収まり、横にスクロールして読める |
| 無料トライアルの案内 | 「Google Cloud の無料トライアルで動いています（2026年12月31日…に終了）」が表示される |
| CSV のダウンロード | 表示中の内容が CSV で保存できる |

### うまくいかないとき

| 画面の表示 | 主な原因 |
|---|---|
| 「アクセス解析はまだ設定されていません」のまま | 3つのどれかが未登録、または本番を再デプロイしていない |
| 赤い注意「GA4_PROXY_URL は https:// で始まる…」 | URL の貼り間違い、またはシークレットが32文字未満（コピーの途中で切れている） |
| 「データは未取得です」 | シークレットが Cloud Run と一致していない（`proxy_rejected`）、GA4 の閲覧者の権限が無い（`api_forbidden`）、中継が止まっている（`network_error`）、GA4 が要求を受け付けない・URL の誤りなど（`api_error`）。下の診断で切り分けます |

取得に失敗しているときも、架空の数値や推定値は表示しません。

### 「未取得」の原因を調べる（読み取りのみ）

Cloud Shell で次を実行します（何も変更しません。シークレット・GA4 の数値は表示しません）。

```
cd ~/ga4-setup/services/ga4-proxy && bash scripts/diagnose.sh 7d
```

ポータルと同じ3つの要求を中継へ送り、HTTP の状態・エラーの種類・所要時間と、Cloud Run のエラーログを表示します。
Cloudflare の Functions のログ（`ga4-analytics-error`）にも、次の項目が記録されます（秘密情報・数値は含みません）。

| 項目 | 意味 |
|---|---|
| `method` | 失敗した要求（`batchRunReports`＝合計・日別・ページなど、`runReport`＝ボタンのクリック） |
| `status` | 中継が返した HTTP の状態（401＝署名の不一致、404＝URL のパスの誤り、502＝GA4 の失敗、503・504＝Cloud Run 本体） |
| `proxyError` | 中継のエラーの種類（`upstream_error` など）。`non_json`＝Cloud Run 本体のエラーページ、`empty_body`＝中継が 404（要求先のパスの誤り）。Cloud Run のログの `ga4-proxy-rejected`（`reason: not_found`）に、届いたパスが記録されます |
| `upstreamStatus` | GA4 が返した HTTP の状態（400＝要求の内容を受け付けない、403＝権限、429＝上限） |
| `cause` | `timeout`＝15秒で応答なし、`fetch_failed`＝接続できない、`exception`＝プログラムの例外（`name` に例外の名前） |

## 3. 元に戻すとき

- Cloudflare の `GA4_PROXY_URL`・`GA4_PROXY_SECRET` を削除して本番を再デプロイすると、画面は「未設定」の案内に戻ります。
- 中継をすぐ止める：`gcloud run services update ga4-proxy --region=asia-northeast1 --project=nobeoka-ugokasu-staff --ingress=internal`
