// ビルド後の dist/ を検査し、SEOの基本要件が満たされているかを確認するスクリプトです。
// 新規のnpm依存を追加せず、Node標準機能（fs/path）と正規表現による軽量パースのみで実装しています。
// 使い方: npm run build のあとに npm run seo:check を実行してください（distが存在しない場合はエラーになります）。

import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = path.resolve(fileURLToPath(import.meta.url), "../..");
const distDir = path.join(rootDir, "dist");

const SECRET_NAMES = [
  "FACEBOOK_PAGE_ACCESS_TOKEN",
  "INSTAGRAM_ACCESS_TOKEN",
  "SOCIAL_SYNC_SECRET",
];

const errors = [];
const warnings = [];

function fail(message) {
  errors.push(message);
}
function warn(message) {
  warnings.push(message);
}

if (!existsSync(distDir)) {
  console.error("dist/ が見つかりません。先に `npm run build` を実行してください。");
  process.exit(1);
}

// ---- 1. dist内の全HTMLファイルを収集し、URLパスへ変換する ----

function walk(dir, files = []) {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      walk(full, files);
    } else if (entry.endsWith(".html")) {
      files.push(full);
    }
  }
  return files;
}

const htmlFiles = walk(distDir);

/** distファイルの絶対パスから、サイト上のURLパスを求める（末尾スラッシュあり方針） */
function toRoutePath(filePath) {
  const rel = path.relative(distDir, filePath).split(path.sep).join("/");
  if (rel === "404.html") return "/404.html"; // Astroが特別扱いする実ファイル名（Cloudflareが実HTTP 404として配信する）
  if (rel === "index.html") return "/";
  if (rel.endsWith("/index.html")) return `/${rel.slice(0, -"index.html".length)}`;
  return `/${rel}`;
}

// ---- 2. サイトのドメインをrobots.txtから取得する ----

const robotsPath = path.join(distDir, "robots.txt");
let siteOrigin = null;
if (existsSync(robotsPath)) {
  const robotsTxt = readFileSync(robotsPath, "utf8");
  const m = robotsTxt.match(/Sitemap:\s*(https?:\/\/[^/\s]+)/);
  if (m) siteOrigin = m[1];
  if (!robotsTxt.includes("Sitemap:")) fail("robots.txtにSitemapの案内がありません。");
} else {
  fail("dist/robots.txt が見つかりません。");
}

// ---- 3. sitemap.xmlのlocを収集する ----

const sitemapLocs = new Set();
const sitemapIndexPath = path.join(distDir, "sitemap-index.xml");
if (existsSync(sitemapIndexPath)) {
  const chunkFiles = readdirSync(distDir).filter((f) => /^sitemap-\d+\.xml$/.test(f));
  for (const chunk of chunkFiles) {
    const xml = readFileSync(path.join(distDir, chunk), "utf8");
    for (const m of xml.matchAll(/<loc>([^<]+)<\/loc>/g)) sitemapLocs.add(m[1]);
  }
  if (sitemapLocs.size === 0) fail("sitemap.xmlにURLが1件も含まれていません。");
} else {
  fail("dist/sitemap-index.xml が見つかりません。");
}

// ---- 4. 各ページを解析する ----

const titleMap = new Map(); // title -> [routePath]
const descriptionMap = new Map();
const canonicalMap = new Map();
const allRoutePaths = new Set(htmlFiles.map(toRoutePath));

function extract(html, regex) {
  const m = html.match(regex);
  return m ? m[1] : null;
}

for (const file of htmlFiles) {
  const route = toRoutePath(file);
  const html = readFileSync(file, "utf8");

  const title = extract(html, /<title>([^<]*)<\/title>/);
  const description = extract(html, /<meta name="description" content="([^"]*)"/);
  const canonical = extract(html, /<link rel="canonical" href="([^"]*)"/);
  const robots = extract(html, /<meta name="robots" content="([^"]*)"/);
  const ogUrl = extract(html, /<meta property="og:url" content="([^"]*)"/);
  const ogImage = extract(html, /<meta property="og:image" content="([^"]*)"/);
  const ogImageAlt = extract(html, /<meta property="og:image:alt" content="([^"]*)"/);
  const h1Count = (html.match(/<h1[\s>]/g) ?? []).length;

  if (!title) fail(`[${route}] <title>が空、または存在しません。`);
  if (!description) fail(`[${route}] meta descriptionが空、または存在しません。`);
  if (!canonical) fail(`[${route}] canonicalが存在しません。`);
  if (!robots) fail(`[${route}] meta robotsが存在しません。`);

  const isNoindex = robots?.startsWith("noindex") ?? false;

  if (route !== "/404.html" && h1Count !== 1) {
    fail(`[${route}] h1が${h1Count}個です（1個である必要があります）。`);
  }

  if (canonical && siteOrigin && !canonical.startsWith(siteOrigin)) {
    fail(`[${route}] canonicalが自サイトのドメインを指していません: ${canonical}`);
  }
  if (canonical && ogUrl && canonical !== ogUrl) {
    fail(`[${route}] canonicalとog:urlが一致しません（canonical=${canonical} / og:url=${ogUrl}）。`);
  }

  if (ogImage) {
    if (!/^https?:\/\//.test(ogImage)) fail(`[${route}] og:imageが絶対URLではありません: ${ogImage}`);
    if (!ogImageAlt) fail(`[${route}] og:image:altが設定されていません。`);
  }

  if (title) {
    if (!titleMap.has(title)) titleMap.set(title, []);
    titleMap.get(title).push(route);
  }
  if (description) {
    if (!descriptionMap.has(description)) descriptionMap.set(description, []);
    descriptionMap.get(description).push(route);
  }
  if (canonical) {
    if (!canonicalMap.has(canonical)) canonicalMap.set(canonical, []);
    canonicalMap.get(canonical).push(route);
  }

  // sitemapとの整合性（404・submit等のnoindexページはsitemapに含まれないのが正しい）
  if (canonical) {
    const inSitemap = sitemapLocs.has(canonical);
    if (!isNoindex && route !== "/404.html" && !inSitemap) {
      warn(`[${route}] インデックス対象だがsitemapに含まれていません: ${canonical}`);
    }
    if (isNoindex && inSitemap) {
      fail(`[${route}] noindexページがsitemapに含まれています: ${canonical}`);
    }
  }

  if (route === "/404.html" && !isNoindex) {
    fail(`[${route}] 404ページがnoindexになっていません。`);
  }

  // JSON-LDの妥当性チェック
  for (const m of html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)) {
    try {
      JSON.parse(m[1]);
    } catch (e) {
      fail(`[${route}] JSON-LDが妥当なJSONではありません: ${e.message}`);
    }
  }

  // 内部リンク切れチェック（相対パス "/..." のみ対象。外部URL・mailto等は対象外）
  for (const m of html.matchAll(/<a\s[^>]*href="(\/[^"]*)"/g)) {
    const href = m[1];
    if (href.startsWith("//")) continue; // プロトコル相対URL（今回は使用していないが念のため除外）
    const cleanHref = href.split("#")[0].split("?")[0];
    if (cleanHref === "") continue;
    const isFile = /\.[a-zA-Z0-9]+$/.test(cleanHref);
    if (isFile) {
      if (!existsSync(path.join(distDir, cleanHref))) {
        fail(`[${route}] リンク切れ（ファイルが存在しません）: ${cleanHref}`);
      }
    } else if (!allRoutePaths.has(cleanHref)) {
      fail(`[${route}] リンク切れ（ページが存在しません）: ${cleanHref}`);
    }
  }
}

// ---- 5. 重複チェック ----

for (const [title, routes] of titleMap) {
  if (routes.length > 1) fail(`titleが重複しています「${title}」: ${routes.join(", ")}`);
}
for (const [description, routes] of descriptionMap) {
  if (routes.length > 1) fail(`descriptionが重複しています「${description.slice(0, 40)}...」: ${routes.join(", ")}`);
}
for (const [canonical, routes] of canonicalMap) {
  if (routes.length > 1) fail(`canonicalが重複しています「${canonical}」: ${routes.join(", ")}`);
}

// ---- 6. 秘密情報の混入チェック ----

function walkAll(dir, files = []) {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) walkAll(full, files);
    else files.push(full);
  }
  return files;
}

const allDistFiles = walkAll(distDir);
for (const file of allDistFiles) {
  let content;
  try {
    content = readFileSync(file, "utf8");
  } catch {
    continue; // バイナリファイル等は対象外
  }
  for (const name of SECRET_NAMES) {
    if (content.includes(name)) {
      fail(`dist内に秘密情報らしき変数名が含まれています（${name}）: ${path.relative(distDir, file)}`);
    }
  }
}

// ---- 結果表示 ----

console.log(`検査対象: ${htmlFiles.length}ページ`);

if (warnings.length > 0) {
  console.log(`\n⚠ 警告 ${warnings.length}件`);
  for (const w of warnings) console.log(`  - ${w}`);
}

if (errors.length > 0) {
  console.log(`\n✗ SEOチェック失敗（${errors.length}件のエラー）`);
  for (const e of errors) console.log(`  - ${e}`);
  process.exit(1);
}

console.log("\n✓ SEOチェックに合格しました。");
