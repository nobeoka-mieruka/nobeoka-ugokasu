#!/bin/bash
# Cloudflare Pages に GA4_PROXY_SECRET を登録するため、署名用シークレットを1回だけ画面に表示します（Cloud Shell で実行）。
#   bash scripts/show-secret.sh
# ・ファイルやレポートには書き込みません。Enter を押すと画面とスクロールの履歴を消去します。
# ・値をメール・チャット・GitHub などに貼り付けないでください。
set -uo pipefail
export CLOUDSDK_CORE_DISABLE_PROMPTS=1
read -r -p "署名用シークレットを画面に表示します。画面共有をしていない・周りに人がいないことを確認したら yes と入力: " ok </dev/tty
[ "$ok" = "yes" ] || { echo "表示しませんでした。"; exit 0; }
value="$(gcloud secrets versions access latest --secret=ga4-proxy-hmac --project=nobeoka-ugokasu-staff 2>/dev/null)" || {
  echo "シークレットを読み取れません（先に bash scripts/setup.sh を実行してください）。"
  exit 1
}
printf '\n----- GA4_PROXY_SECRET（この1行だけをコピー）-----\n%s\n--------------------------------------------------\n\n' "$value" >/dev/tty
unset value
read -r -p "Cloudflare に貼り付けて保存したら Enter を押してください（画面を消去します）" _ </dev/tty
printf '\033[3J\033[H\033[2J' >/dev/tty
echo "画面を消去しました。"
