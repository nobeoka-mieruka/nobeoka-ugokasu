#!/bin/bash
# GA4 中継を Cloud Run にデプロイします（承認を得てから、Cloud Shell で services/ga4-proxy に移動して実行）。
#   bash scripts/deploy.sh <GA4用サービスアカウントのメールアドレス>
# 前提：シークレット ga4-proxy-hmac を作成済みで、サービスアカウントに読み取り権限を付けてあること（README.md）。
# このスクリプトはシークレットの値を表示・作成しません。
#
# 無料枠を最大限使うための設定（無料枠の数値は Google Cloud の料金ページで最新のものを確認してください）
#   --min-instances=0           使っていない間はインスタンスを0にする（待機中の料金なし）
#   --max-instances=1           同時に動くのは最大1つ（攻撃されても費用に上限がかかる。nonce の記録も1か所で済む）
#   --cpu-throttling            要求を処理している間だけCPUを使う（リクエスト単位の課金。無料枠の対象）
#   --no-cpu-boost              起動時のCPU増強を使わない
#   --cpu=1 --memory=256Mi      中継に十分な最小構成（256Mi は第1世代の実行環境で使える）
#   --execution-environment=gen1
#   --concurrency=10 --timeout=15
#   --region=asia-northeast1    東京
set -euo pipefail
PROJECT="nobeoka-ugokasu-staff"
REGION="asia-northeast1"
SA="${1:?GA4用サービスアカウントのメールアドレスを指定してください}"

read -r -p "Cloud Run に ga4-proxy をデプロイします（インターネットから呼べる状態になります。署名の無い要求は拒否します）。続けますか？ [yes/NO] " answer
[ "$answer" = "yes" ] || { echo "中止しました。"; exit 1; }

gcloud run deploy ga4-proxy --source . --project="$PROJECT" --region="$REGION" \
  --service-account="$SA" --no-invoker-iam-check --ingress=all \
  --set-env-vars=GA4_PROPERTY_ID=546942310 \
  --set-secrets=PROXY_HMAC_SECRET=ga4-proxy-hmac:latest \
  --min-instances=0 --max-instances=1 --cpu-throttling --no-cpu-boost \
  --cpu=1 --memory=256Mi --execution-environment=gen1 \
  --concurrency=10 --timeout=15 \
  --labels=app=nobeoka-ugokasu,purpose=ga4-proxy

# 古いコンテナイメージを自動で消す（Artifact Registry の無料枠 0.5GB に収める）
if gcloud artifacts repositories describe cloud-run-source-deploy --project="$PROJECT" --location="$REGION" >/dev/null 2>&1; then
  gcloud artifacts repositories set-cleanup-policies cloud-run-source-deploy --project="$PROJECT" --location="$REGION" \
    --policy=scripts/cleanup-policy.json --no-dry-run
fi

URL="$(gcloud run services describe ga4-proxy --project="$PROJECT" --region="$REGION" --format='value(status.url)')"
echo "デプロイしました：$URL"
echo "確認：/healthz が 204、署名なしの POST が 401 になること"
curl -s -o /dev/null -w "healthz: %{http_code}\n" "$URL/healthz"
curl -s -o /dev/null -w "署名なしの POST: %{http_code}\n" -X POST "$URL/v1/runReport" -d '{}'
