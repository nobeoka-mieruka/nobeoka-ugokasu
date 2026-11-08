// サイトの定期チェック（.github/workflows/site-monitor.yml から1時間ごとに実行）
//
// 調べること（すべて読み取りだけ。サイトの内容は変更しない）
//   deploy      … mainの最新コミットが本番に反映されているか（/build-version.json と比べる）
//   site_update … 自動処理（GitHub Actions）の最新の実行が失敗していないか
//   rss         … /rss.xml と /news/（お知らせ一覧）・トップページの内容と順番が一致しているか
//   sns_build   … SNSの定期取得（/api/social-feed）は最新なのに、公開中のHTML（検索エンジンが読む内容）だけ古いままになっていないか
//                 （判定は scripts/social-rebuild.mjs。再ビルドは既存の refresh-social-posts.yml が行う。ここでは再ビルドしない）
//   dialogue_form … 意見交換会ページの申込受付の表示と、Googleフォームの実際の受付状態が一致しているか
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
import { decideSocialRebuild, STALE_HTML_MINUTES } from "../social-rebuild.mjs";

/** 意見交換会の申込フォーム（src/config/dialogueConfig.ts の GOOGLE_FORM_URL と同じ。テストで一致を確認） */
export const DIALOGUE_FORM_URL =
  "https://docs.google.com/forms/d/e/1FAIpQLScmY6pGcRApiGwAgG2o0PaWqspnjv2cgqwg_tpaEKNkD5tLOQ/viewform";

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

/**
 * 公開中のHTML（ビルド）のSNS投稿が、定期取得した最新の内容に追いついているか。
 * 再ビルド待ち（直前のビルドから間もない・不一致になって間もない）は正常とし、
 * 不一致が STALE_HTML_MINUTES 分以上続いたときだけ「要確認」にする。
 */
export function evaluateSnsBuild({ feed, manifest, now = Date.now() }) {
  if (!feed) return { key: "sns_build", status: "warning", summary: "SNSの本番API（/api/social-feed）を読めませんでした。" };
  if (!manifest) return { key: "sns_build", status: "warning", summary: "公開中のビルドのSNS情報（/social-build-manifest.json）を読めませんでした。" };
  const result = decideSocialRebuild({ feed, manifest, now });
  const builtAt = manifest.generatedAt ? `（公開中のHTMLのビルド：${formatJst(manifest.generatedAt)}）` : "";
  if (result.state === "match") return { key: "sns_build", status: "ok", summary: `公開中のHTMLは最新のSNS投稿と一致しています${builtAt}。` };
  if (result.state === "waiting" || (result.buildAgeMinutes !== null && result.buildAgeMinutes < STALE_HTML_MINUTES)) {
    return { key: "sns_build", status: "ok", summary: `新しいSNS投稿の公開中のHTMLへの反映を待っています${builtAt}。` };
  }
  return {
    key: "sns_build",
    status: "warning",
    summary: `SNSの定期取得は最新ですが、公開中のHTML（検索エンジン向け）が${STALE_HTML_MINUTES}分以上古いままです${builtAt}。GitHubのActionsタブで「Refresh social posts」の実行結果を確認してください。`,
  };
}

/**
 * Googleフォームのページ（申込フォームURLをGETした結果）から、回答を受け付けているかを判定する。
 * 受付を止めたフォームは /closedform へ転送され「回答を受け付けていません」と表示される。判断できない場合は null。
 */
export function googleFormAccepting({ finalUrl, html }) {
  if (typeof finalUrl === "string" && /\/closedform(\?|$)/.test(finalUrl)) return false;
  if (typeof html !== "string") return null;
  if (/回答を受け付けていません|no longer accepting responses/i.test(html)) return false;
  if (html.includes("FB_PUBLIC_LOAD_DATA_") && typeof finalUrl === "string" && /\/viewform(\?|$)/.test(finalUrl)) return true;
  return null;
}

/** 意見交換会ページの申込受付の表示（[data-dialogue-form-apply] の中身）。判断できない場合は null */
export function dialoguePageAccepting(html) {
  if (typeof html !== "string") return null;
  if (html.includes("data-dialogue-form-closed")) return false;
  if (html.includes("data-dialogue-form-open")) return true;
  return null;
}

export function evaluateDialogueForm({ pageAccepting, formAccepting }) {
  if (pageAccepting === null) return { key: "dialogue_form", status: "warning", summary: "意見交換会ページの申込受付の表示を読み取れませんでした。" };
  if (formAccepting === null) return { key: "dialogue_form", status: "warning", summary: "Googleフォームの受付状態を確認できませんでした。" };
  if (pageAccepting === formAccepting) {
    return {
      key: "dialogue_form",
      status: "ok",
      summary: pageAccepting ? "意見交換会ページの申込受付中の表示と、Googleフォームの受付状態が一致しています。" : "申込受付は終了しており、Googleフォームも回答を受け付けていません。",
    };
  }
  if (pageAccepting) {
    return {
      key: "dialogue_form",
      status: "error",
      summary: "意見交換会ページは申込受付中ですが、Googleフォームが回答を受け付けていません（申し込めない状態です）。フォームの受付を再開するか、src/data/welfareDialogue.ts の WELFARE_DIALOGUE_FORM_ACCEPTING を false にしてください。",
    };
  }
  return {
    key: "dialogue_form",
    status: "warning",
    summary: "意見交換会ページは申込受付を終了していますが、Googleフォームは回答を受け付けたままです。Googleフォームの「回答を受け付ける」をオフにしてください。",
  };
}

function formatJst(iso) {
  const time = Date.parse(iso);
  if (!Number.isFinite(time)) return "不明";
  return new Date(time).toLocaleString("ja-JP", { timeZone: "Asia/Tokyo", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

async function fetchText(url) {
  try {
    const res = await fetch(url, { headers: { "Cache-Control": "no-cache" }, signal: AbortSignal.timeout(30000) });
    return res.ok ? await res.text() : null;
  } catch {
    return null;
  }
}

async function fetchJson(url) {
  const text = await fetchText(url);
  if (text === null) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/** Googleフォームの公開ページを読む（読み取りだけ。回答は送らない） */
async function fetchFormPage(url) {
  try {
    const res = await fetch(url, { headers: { "Accept-Language": "ja" }, redirect: "follow", signal: AbortSignal.timeout(30000) });
    return { finalUrl: res.url, html: res.ok ? await res.text() : null };
  } catch {
    return { finalUrl: null, html: null };
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
  const stamp = `t=${Date.now()}`;
  const [versionText, rssXml, newsHtml, homeHtml, feed, manifest, dialogueHtml, formPage] = await Promise.all([
    fetchText(`${site}/build-version.json`),
    fetchText(`${site}/rss.xml`),
    fetchText(`${site}/news/`),
    fetchText(`${site}/`),
    fetchJson(`${site}/api/social-feed?${stamp}`),
    fetchJson(`${site}/social-build-manifest.json?${stamp}`),
    fetchText(`${site}/dialogue/`),
    fetchFormPage(DIALOGUE_FORM_URL),
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
    evaluateSnsBuild({ feed, manifest }),
    evaluateDialogueForm({ pageAccepting: dialoguePageAccepting(dialogueHtml), formAccepting: googleFormAccepting(formPage) }),
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
