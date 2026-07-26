// /vision の各提言と活動報告（Facebook投稿・SNS手動登録・公式サイト活動報告）を
// 関連付けるための共通ロジック。ビルド時（vision.astro frontmatter）と
// クライアント側（vision.astroの<script>、ブラウザ取得分の反映）の両方から使う。

/** タイトル・本文にキーワードのいずれかが含まれるか（単純な部分一致） */
export function textMatchesKeywords(text: string, keywords: string[]): boolean {
  return keywords.some((keyword) => text.includes(keyword));
}
