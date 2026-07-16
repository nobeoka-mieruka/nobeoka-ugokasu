// ビルド前に実行し、サイトの「最終更新日時」表示に使う src/data/build-info.json を生成します。
// git・Cloudflare Pagesのどちらが使えない環境でもビルドを失敗させないよう、
// 取得できなかった項目はnullのまま安全側に倒します（画面には表示されません）。

import { execSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const outputPath = path.resolve(fileURLToPath(import.meta.url), "../../src/data/build-info.json");

function tryExec(command) {
  try {
    const result = execSync(command, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
    return result || null;
  } catch {
    return null;
  }
}

function isValidIsoDate(value) {
  if (!value) return false;
  const parsed = new Date(value);
  return !Number.isNaN(parsed.getTime());
}

// 優先順位 1：最新のGitコミット日時（コミッター日時、ISO 8601形式）
const gitCommitDate = tryExec("git log -1 --format=%cI");
const gitCommitSha = tryExec("git log -1 --format=%H");

// 優先順位 2：環境変数で明示的に指定された日時（gitが使えない特殊な環境向けの保険）
const envDate = process.env.SITE_LAST_UPDATED;

// 優先順位 3：ビルドを開始した現在日時（最終手段）
const now = new Date().toISOString();

let lastUpdated = null;
if (isValidIsoDate(gitCommitDate)) {
  lastUpdated = new Date(gitCommitDate).toISOString();
} else if (isValidIsoDate(envDate)) {
  lastUpdated = new Date(envDate).toISOString();
} else {
  lastUpdated = now;
}

const buildInfo = {
  lastUpdated,
  commitSha: gitCommitSha ?? process.env.CF_PAGES_COMMIT_SHA ?? null,
  isCloudflarePages: Boolean(process.env.CF_PAGES),
  generatedAt: now,
};

writeFileSync(outputPath, `${JSON.stringify(buildInfo, null, 2)}\n`, "utf8");

// アクセストークン等の秘密情報は一切含まれないため、内容をログへ出しても問題ない
console.log(`[generate-build-info] wrote ${outputPath}`);
console.log(`[generate-build-info] lastUpdated=${buildInfo.lastUpdated} isCloudflarePages=${buildInfo.isCloudflarePages}`);
