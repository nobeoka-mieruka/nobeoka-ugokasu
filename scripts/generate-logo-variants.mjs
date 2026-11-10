// ヘッダーのロゴ画像を、表示サイズに合った軽い画像（WebP・PNG）に変換するスクリプトです。
//   node scripts/generate-logo-variants.mjs
//
// 元画像 public/images/logo/kouenkainamaeirilogo.png は 2172×724px・約0.9MB あり、
// ヘッダーでは幅 220〜360px で表示するため、スマートフォンの表示速度（LCP）を大きく下げていました。
// 表示幅の2倍（高解像度の画面向け）までの画像を作り、Header.astro の <picture> で使い分けます。
// 元画像は構造化データ（Organization の logo）用にそのまま残します。
// ロゴを差し替えたときは、元画像を置き換えてからこのスクリプトを実行し、できた画像をコミットしてください。

import sharp from "sharp";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(fileURLToPath(import.meta.url), "../..");
const source = path.join(root, "public/images/logo/kouenkainamaeirilogo.png");
const outDir = path.join(root, "public/images/logo");

/** 表示幅 220px・260px・360px の2倍 */
export const LOGO_WIDTHS = [440, 520, 720];

for (const width of LOGO_WIDTHS) {
  const resized = sharp(source).resize({ width, withoutEnlargement: true });
  await resized.clone().webp({ quality: 88, effort: 6 }).toFile(path.join(outDir, `logo-${width}.webp`));
  await resized.clone().png({ compressionLevel: 9, palette: true, quality: 90 }).toFile(path.join(outDir, `logo-${width}.png`));
  console.log(`logo-${width}.webp / logo-${width}.png`);
}
