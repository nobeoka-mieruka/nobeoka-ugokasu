// setup.sh から使う判定（標準入力の JSON を読み、1行で結果を返す。秘密情報は扱わない）。
//   gcloud resource-manager org-policies describe <制約> --effective --format=json | node scripts/eval.mjs policy <制約>
//   gcloud run services describe ga4-proxy --format=json | node scripts/eval.mjs service <GA4用サービスアカウント>
// 出力：「OK|説明」「NG|説明」「INFO|説明」のどれか1行（判定の中身は eval-lib.mjs）

import { readFileSync } from "node:fs";
import { evaluatePolicy, evaluateService } from "./eval-lib.mjs";

const [mode, arg] = process.argv.slice(2);
let data;
try {
  data = JSON.parse(readFileSync(0, "utf8") || "{}");
} catch {
  data = null;
}
const result = !data
  ? ["NG", "JSONを読み取れません"]
  : mode === "policy"
    ? evaluatePolicy(arg ?? "", data)
    : mode === "service"
      ? evaluateService(arg ?? "", data)
      : ["NG", "使い方: eval.mjs policy <制約> | service <サービスアカウント>"];
console.log(result.join("|"));
