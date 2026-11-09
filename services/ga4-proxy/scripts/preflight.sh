#!/bin/bash
# GA4 中継を導入する前の確認（読み取り専用）。Google Cloud の Cloud Shell で実行します。
#   bash preflight.sh <GA4用サービスアカウントのメールアドレス>
# このスクリプトは「見る」だけです。APIの有効化・権限の追加・設定の変更・課金の紐付けは一切行いません。
# 出力にシークレットや鍵は含まれません（そもそも作成・参照しません）。

PROJECT="nobeoka-ugokasu-staff"
SA="${1:-}"
if [ -z "$SA" ]; then
  echo "使い方: bash preflight.sh <GA4用サービスアカウントのメールアドレス>"
  exit 1
fi

section() { printf '\n==== %s ====\n' "$1"; }

section "1. 課金アカウントの紐付け（billingEnabled が true なら紐付け済み）"
gcloud billing projects describe "$PROJECT" --format="yaml(billingEnabled,billingAccountName)"

section "2. APIの有効化状況（一覧に出たものが有効）"
gcloud services list --enabled --project="$PROJECT" \
  --filter="config.name:(run.googleapis.com cloudbuild.googleapis.com artifactregistry.googleapis.com secretmanager.googleapis.com analyticsdata.googleapis.com iamcredentials.googleapis.com)" \
  --format="value(config.name)"

section "3. 組織ポリシー（プロジェクトに実際に効いている内容）"
for c in \
  iam.disableServiceAccountKeyCreation \
  iam.automaticIamGrantsForDefaultServiceAccounts \
  iam.allowedPolicyMemberDomains \
  gcp.resourceLocations \
  gcp.restrictServiceUsage \
  run.allowedIngress \
  run.allowedBinaryAuthorizationPolicies \
  run.managed.requireInvokerIam \
  compute.requireOsLogin; do
  echo "--- $c"
  gcloud org-policies describe "$c" --effective --project="$PROJECT" --format="yaml(spec.rules)" 2>&1 | head -20
done

section "4. サービスアカウント（存在・無効化されていないか・鍵が無いこと）"
gcloud iam service-accounts describe "$SA" --project="$PROJECT" --format="yaml(email,disabled)"
echo "--- ユーザー管理の鍵（0件であること）"
gcloud iam service-accounts keys list --iam-account="$SA" --project="$PROJECT" --managed-by=user --format="value(name)" | wc -l

section "5. サービスアカウントに付いているプロジェクトのロール（何も無いのが理想）"
gcloud projects get-iam-policy "$PROJECT" --flatten="bindings[].members" \
  --filter="bindings.members:serviceAccount:$SA" --format="value(bindings.role)"

section "6. 自分（実行している人）のプロジェクトでのロール"
ME="$(gcloud config get-value account 2>/dev/null)"
gcloud projects get-iam-policy "$PROJECT" --flatten="bindings[].members" \
  --filter="bindings.members:user:$ME" --format="value(bindings.role)"

section "7. 既存の Cloud Run サービス・シークレット（API が無効なら「未有効」のエラーになります）"
gcloud run services list --project="$PROJECT" --format="value(metadata.name,status.url)" 2>&1 | head -5
gcloud secrets list --project="$PROJECT" --format="value(name)" 2>&1 | head -5

echo
echo "確認は以上です。何も変更していません。"
