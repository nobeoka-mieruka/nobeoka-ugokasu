// サイトの定期チェック（.github/workflows/site-monitor.yml から1時間ごとに実行）
//
// 調べること（すべて読み取りだけ。サイトの内容は変更しない）
//   deploy      … mainの最新コミットが本番に反映されているか（/build-version.json と比べる）
//   site_update … 自動処理（GitHub Actions）の最新の実行が失敗していないか
//   rss         … /rss.xml と /news/（お知らせ一覧）・トップページの内容と順番が一致しているか
// 結果は POST /api/admin/site-health に送り、執行部ポータルの「サイトの状態」（/staff/status/）に表示する。
// 送る内容は「種類・状態・短い説明」だけ。秘密キーはログに出さない。
//
// 環境変数
//   SITE_URL         … 本番のURL（例：https://nobeoka-ugokasu.pages.dev）
//   SECRET           … NEWS_DETECT_SECRET（未設定なら結果をログに出すだけで送らない）
//   HEAD_SHA         … mainの最新コミット
//   HEAD_COMMITTED_AT… そのコミットの日時（ISO 8601）
//   GITHUB_TOKEN, GITHUB_REPOSITORY … 自動処理の実行結果を読むため（読み取り権限だけ）

import { pathToFileURL } from "node:url";

/** 最新のコミットが本番へ反映されるまで待つ時間（これを過ぎても反映されていなければ失敗） */
export const DEPLOY_GRACE_MINUTES = 30;
/** 実行結果を確認する自動処理 */
export const WATCHED_WORKFLOWS = [
  { file: "detect-new-pages.yml", label: "新しいページの検知（Detect new pages）" },
  { file: "refresh-social-posts.yml", label: "SNS投稿の再ビルド（Refresh social posts）" },
];

const ENTITIES = { "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&#39;": "'", "&apos;": "'" };
export const unescapeXml = (text) => text.replace(/&(amp|lt|gt|quot|#39|apos);/g, (m) => ENTITIES[m]);

/** RSSの各お知らせのタイトル（順番どおり） */
export function rssTitles(xml) {
  return [...xml.matchAll(/<item><title>([\s\S]*?)<\/title>/g)].map((m) => unescapeXml(m[1]).trim());
}

/** お知らせ一覧（[data-news-list]）・トップページ（[data-news-home]）のカードのタイトル（順番どおり） */
export function cardTitles(html, marker) {
  const start = html.indexOf(marker);
  if (start < 0) return null;
  const rest = html.slice(start);
  return [...rest.matchAll(/<h3 class="text-xl font-bold text-ink leading-snug[^"]*">([\s\S]*?)<\/h3>/g)].map((m) => unescapeXml(m[1]).trim());
}

/** 本番デプロイの判定 */
export function evaluateDeploy({ liveSha, headSha, headCommittedAt, now = Date.now() }) {
  const short = (sha) => (sha ? sha.slice(0, 7) : "不明");
  if (!liveSha) return { key: "deploy", status: "warning", summary: "公開中のビルド情報（/build-version.json）を読めませんでした。" };
  if (!headSha) return { key: "deploy", status: "warning", summary: `mainの最新コミットを確認できませんでした（公開中：${short(liveSha)}）。` };
  if (liveSha === headSha) return { key: "deploy", status: "ok", summary: `本番はmainの最新コミット（${short(headSha)}）です。` };
  const ageMinutes = headCommittedAt ? (now - Date.parse(headCommittedAt)) / 60000 : Infinity;
  if (ageMinutes < DEPLOY_GRACE_MINUTES) {
    return { key: "deploy", status: "ok", summary: `mainの最新コミット（${short(headSha)}）を反映中です（公開中：${short(liveSha)}）。` };
  }
  return {
    key: "deploy",
    status: "error",
    summary: `mainの最新コミット（${short(headSha)}）が${DEPLOY_GRACE_MINUTES}分以上たっても本番に反映されていません（公開中：${short(liveSha)}）。Cloudflare Pagesのデプロイ履歴でビルドの失敗を確認してください。`,
  };
}

/** 自動処理の判定。runs は { label, conclusion, createdAt } の一覧（実行履歴が無いものは含めない） */
export function evaluateWorkflows(runs) {
  const failed = runs.filter((r) => r.conclusion && !["success", "skipped", "cancelled", "neutral"].includes(r.conclusion));
  if (failed.length === 0) return { key: "site_update", status: "ok", summary: "自動処理の最新の実行はすべて成功しています。" };
  return {
    key: "site_update",
    status: "error",
    summary: `${failed.map((r) => r.label).join("・")}の最新の実行が失敗しました。GitHubのActionsタブでログを確認してください。`,
  };
}

/** RSSとお知らせ一覧・トップページの一致の判定 */
export function evaluateRss({ rss, list, home }) {
  if (rss === null || list === null) return { key: "rss", status: "warning", summary: "RSSまたはお知らせ一覧を読めませんでした。" };
  const listDiff = rss.length !== list.length || rss.some((t, i) => t !== list[i]);
  const homeDiff = home !== null && home.some((t, i) => t !== rss[i]);
  if (!listDiff && !homeDiff) return { key: "rss", status: "ok", summary: `RSS・お知らせ一覧・トップページの内容と順番が一致しています（${rss.length}件）。` };
  const parts = [];
  if (listDiff) parts.push(`RSSは${rss.length}件、お知らせ一覧は${list.length}件で、内容または順番が違います`);
  if (homeDiff) parts.push("トップページの「最新のお知らせ」がRSSの先頭と違います");
  return { key: "rss", status: "warning", summary: `${parts.join("。")}。数分後に自然に解消しない場合は確認してください。` };
}

async function fetchText(url) {
  try {
    const res = await fetch(url, { headers: { "Cache-Control": "no-cache" }, signal: AbortSignal.timeout(30000) });
    return res.ok ? await res.text() : null;
  } catch {
    return null;
  }
}

async function latestRun(file) {
  const repo = process.env.GITHUB_REPOSITORY;
  const token = process.env.GITHUB_TOKEN;
  if (!repo || !token) return null;
  try {
    const res = await fetch(`https://api.github.com/repos/${repo}/actions/workflows/${file}/runs?branch=main&status=completed&per_page=1`, {
      headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json" },
      signal: AbortSignal.timeout(30000),
    });
    if (!res.ok) return null;
    const body = await res.json();
    const run = body.workflow_runs?.[0];
    return run ? { conclusion: run.conclusion, createdAt: run.created_at } : null;
  } catch {
    return null;
  }
}

export async function runChecks(env = process.env) {
  const site = (env.SITE_URL ?? "").replace(/\/$/, "");
  const [versionText, rssXml, newsHtml, homeHtml] = await Promise.all([
    fetchText(`${site}/build-version.json`),
    fetchText(`${site}/rss.xml`),
    fetchText(`${site}/news/`),
    fetchText(`${site}/`),
  ]);
  let liveSha = null;
  try {
    liveSha = versionText ? (JSON.parse(versionText).commitSha ?? null) : null;
  } catch {
    liveSha = null;
  }
  const runs = [];
  for (const workflow of WATCHED_WORKFLOWS) {
    const run = await latestRun(workflow.file);
    if (run) runs.push({ label: workflow.label, ...run });
  }
  return [
    evaluateDeploy({ liveSha, headSha: env.HEAD_SHA || null, headCommittedAt: env.HEAD_COMMITTED_AT || null }),
    evaluateWorkflows(runs),
    evaluateRss({
      rss: rssXml === null ? null : rssTitles(rssXml),
      list: newsHtml === null ? null : cardTitles(newsHtml, "data-news-list"),
      home: homeHtml === null ? null : cardTitles(homeHtml, "data-news-home"),
    }),
  ];
}

async function main() {
  const checks = await runChecks();
  const mark = { ok: "正常", warning: "要確認", error: "失敗" };
  for (const c of checks) {
    const line = `[${mark[c.status]}] ${c.key}: ${c.summary}`;
    console.log(c.status === "ok" ? line : `::${c.status === "error" ? "error" : "warning"}::${line}`);
  }
  const secret = process.env.SECRET;
  if (!secret) {
    console.log("::warning::NEWS_DETECT_SECRET が未設定のため、結果を執行部ポータルへ送りませんでした。");
    return;
  }
  const site = (process.env.SITE_URL ?? "").replace(/\/$/, "");
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetch(`${site}/api/admin/site-health`, {
        method: "POST",
        headers: { Authorization: `Bearer ${secret}`, "Content-Type": "application/json" },
        body: JSON.stringify({ checks }),
        signal: AbortSignal.timeout(30000),
      });
      if (res.ok) {
        const body = await res.json();
        console.log(`執行部ポータルへ記録しました（更新：${body.written?.length ?? 0}件、新たな異常：${body.alerted?.length ?? 0}件）。`);
        return;
      }
      if (res.status === 401 || res.status === 404 || res.status === 405) {
        console.log(`::warning::執行部ポータルへ記録できませんでした（HTTP ${res.status}）。秘密キーの設定、または機能の公開状況を確認してください。`);
        return;
      }
      console.log(`(${attempt}/3) 記録に失敗しました（HTTP ${res.status}）。`);
    } catch {
      console.log(`(${attempt}/3) 記録の送信に失敗しました（通信エラー）。`);
    }
    await new Promise((r) => setTimeout(r, 10000));
  }
  console.log("::warning::執行部ポータルへ記録できませんでした。次回の定期チェックで再度記録します。");
}

// 直接実行したときだけ動く（テストに取り込まれたときは動かない）
if (process.argv[1] && /site-check.mjs$/.test(process.argv[1]) && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
