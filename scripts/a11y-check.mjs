// ビルド後の dist/ を検査し、アクセシビリティ（WCAG 2.2 AA）と表示速度の基本要件が守られているかを確認するスクリプトです。
// seo-check.mjs と同じく、新規のnpm依存を追加せず、Node標準機能と正規表現による軽量パースだけで実装しています。
// 使い方: npm run build のあとに npm run check:a11y を実行してください。
//
// ここで確認できるのは「HTMLの書き方」で判定できる項目だけです。色のコントラストの実測・キーボード操作・
// 画面の拡大・読み上げの聞こえ方などは、ブラウザでの確認（docs/accessibility-checklist.md）が必要です。

import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = path.resolve(fileURLToPath(import.meta.url), "../..");
// 引数で別の dist を指定できる（修正前のビルドと比べるときなど）
const distDir = process.argv[2] ? path.resolve(process.argv[2]) : path.join(rootDir, "dist");

/** ページに読み込む1枚の画像の上限（バイト）。これを超えるとスマートフォンの表示（LCP）が遅くなる */
export const MAX_IMAGE_BYTES = 400 * 1024;

const errors = [];
const fail = (message) => errors.push(message);

if (!existsSync(distDir)) {
  console.error("dist/ が見つかりません。先に `npm run build` を実行してください。");
  process.exit(1);
}

function walk(dir, files = []) {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, files);
    else if (entry.endsWith(".html")) files.push(full);
  }
  return files;
}

/** 見えている文字（タグ・読み上げ専用の文字・空白を除く） */
function visibleText(html) {
  return html
    .replace(/<span class="sr-only">[\s\S]*?<\/span>/g, "")
    .replace(/<svg[\s\S]*?<\/svg>/g, "")
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&[a-z]+;|&#\d+;/g, "")
    .replace(/\s+/g, "");
}

const htmlFiles = walk(distDir);
const imageRefs = new Map();

for (const file of htmlFiles) {
  const rel = path.relative(distDir, file).split(path.sep).join("/");
  const route = rel === "index.html" ? "/" : `/${rel.replace(/index\.html$/, "")}`;
  const isStaff = route.startsWith("/staff/");
  const html = readFileSync(file, "utf8");
  // コメント・<template>・<script> の中は画面に出ないため検査しない
  const body = html
    .slice(html.indexOf("<body"))
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<template\b[\s\S]*?<\/template>/g, "")
    .replace(/<script\b[\s\S]*?<\/script>/g, "");

  // 1. 言語の指定（3.1.1）
  if (!/<html lang="ja"/.test(html)) fail(`${route}: <html lang="ja"> がありません`);

  // 2. 見出し：ページの主題を示す h1 は1つ（1.3.1・2.4.6）
  const h1Count = (body.match(/<h1[\s>]/g) ?? []).length;
  if (!isStaff && h1Count !== 1) fail(`${route}: h1 が ${h1Count} 個あります（1つにしてください）`);

  // 3. 画像の代替テキスト（1.1.1）：装飾画像も alt="" を明示する
  for (const m of body.matchAll(/<img\b[^>]*>/g)) {
    if (!/\salt=/.test(m[0])) fail(`${route}: alt の無い画像があります: ${m[0].slice(0, 120)}`);
    const src = /\ssrc="([^"]+)"/.exec(m[0])?.[1];
    if (src?.startsWith("/") && !src.startsWith("/api/")) imageRefs.set(src.split("?")[0], route);
  }
  for (const m of body.matchAll(/\ssrcset="([^"]+)"/g)) {
    for (const part of m[1].split(",")) {
      const src = part.trim().split(/\s+/)[0];
      if (src?.startsWith("/") && !src.startsWith("/api/")) imageRefs.set(src.split("?")[0], route);
    }
  }

  // 4. 見えている文字と読み上げ名の一致（2.5.3）：aria-label は、リンク・ボタンに見えている文字から始める
  //    （音声入力で「〇〇をクリック」と言ったときに選べるように。後ろに補足を付けるのは可）
  for (const m of body.matchAll(/<(a|button)\b([^>]*\saria-label="([^"]*)"[^>]*)>([\s\S]*?)<\/\1>/g)) {
    const label = m[3].replace(/\s+/g, "");
    const text = visibleText(m[4]);
    if (text && !label.startsWith(text)) {
      fail(`${route}: 読み上げ名（aria-label="${m[3]}"）が、見えている文字「${text.slice(0, 40)}」で始まっていません`);
    }
  }

  // 5. 文字の濃さ（1.4.3）：薄すぎる文字色（不透明度70%以下の ink-soft）は、装飾アイコン・無効な部品以外に使わない
  for (const m of body.matchAll(/<(\w+)\b[^>]*class="([^"]*\btext-ink-soft\/(?:[1-6]0|70)\b[^"]*)"[^>]*>/g)) {
    const tag = m[0];
    if (m[1] === "svg" || /aria-disabled="true"|cursor-not-allowed/.test(tag)) continue;
    fail(`${route}: 背景とのコントラストが不足する文字色（${/text-ink-soft\/\d+/.exec(m[2])[0]}）が使われています`);
  }

  // 6. モバイルメニュー：開いている間はダイアログとして扱い、背後へ移動しない（2.4.3・4.1.2）
  const panel = /<div\b[^>]*id="mobile-menu-panel"[^>]*>/.exec(body)?.[0];
  if (panel && !(/role="dialog"/.test(panel) && /aria-modal="true"/.test(panel) && /aria-labelledby="/.test(panel))) {
    fail(`${route}: モバイルメニューに role="dialog"・aria-modal・aria-labelledby がありません`);
  }

  // 7. ボタン・リンクの名前（4.1.2）：中身が空（アイコンだけ）なら aria-label か読み上げ用の文字が必要
  //    執行部ポータル（/staff/）と、最初は非表示で JavaScript が文字を入れる部品（class="hidden"）は、ブラウザでの確認に任せる
  for (const m of isStaff ? [] : body.matchAll(/<(a|button)\b([^>]*)>([\s\S]*?)<\/\1>/g)) {
    if (/aria-label="[^"]+"|aria-labelledby="/.test(m[2])) continue;
    if (/\sclass="(?:[^"]*\s)?hidden(?:\s[^"]*)?"/.test(m[2]) || /\shidden(?=[\s>=]|$)/.test(m[2])) continue;
    const inner = m[3];
    const hasText = visibleText(inner) || /<span class="sr-only">[^<]+<\/span>/.test(inner) || /<img\b[^>]*\salt="[^"]+"/.test(inner);
    if (!hasText) fail(`${route}: 名前の無い${m[1] === "a" ? "リンク" : "ボタン"}があります: <${m[1]}${m[2].slice(0, 100)}>`);
  }
}

// 8. 表示速度：ページで使う画像が大きすぎないこと（ヘッダーのロゴ 0.9MB がスマートフォンの表示を約4秒遅くしていた）
for (const [src, route] of imageRefs) {
  const file = path.join(distDir, decodeURIComponent(src));
  if (!existsSync(file)) {
    fail(`${route}: 画像が見つかりません: ${src}`);
    continue;
  }
  const size = statSync(file).size;
  if (size > MAX_IMAGE_BYTES) fail(`${route}: 画像が大きすぎます（${Math.round(size / 1024)}KB > ${MAX_IMAGE_BYTES / 1024}KB）: ${src}`);
}

console.log(`検査対象: ${htmlFiles.length}ページ、画像 ${imageRefs.size}件`);
if (errors.length > 0) {
  console.log(`\n✗ アクセシビリティチェック失敗（${errors.length}件）`);
  for (const e of errors.slice(0, 60)) console.log(`  - ${e}`);
  process.exit(1);
}
console.log("\n✓ アクセシビリティチェックに合格しました。");
