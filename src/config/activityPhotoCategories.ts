// =============================================================
// 活動写真ページ（/photos）のカテゴリ分けを管理するファイルです。
//
// -------------------------------------------------------------
// 【カテゴリの決まり方（優先順位）】
//   1. 投稿ID・記事slugで明示的に指定したカテゴリ（下の photoCategoryOverrides）
//   2. 活動報告記事の category（src/content/activities/ の frontmatter）
//   3. 投稿タイトル・本文に含まれるキーワードからの推定（下の CATEGORY_KEYWORDS）
//   4. どれにも当てはまらない場合は「その他」
//
// 【誤分類を防ぐための注意】
// ・キーワード推定は補助的な手段です。確実に分類したい投稿は、必ず 1 の
//   photoCategoryOverrides へ投稿IDを追加してください。
// ・キーワードは、その語が含まれていれば内容がほぼ確実に一致するものだけにしてください
//   （例：「看板」→ 看板設置）。曖昧な語を足すと誤分類の原因になります。
//
// 【表示ルール】
// ・写真が1枚も無いカテゴリは、絞り込みボタンに表示されません（/photos/ 側で自動判定）。
// =============================================================

export const PHOTO_CATEGORIES = [
  "看板設置",
  "地域活動",
  "意見交換",
  "福祉活動",
  "イベント",
  "その他",
] as const;

export type PhotoCategory = (typeof PHOTO_CATEGORIES)[number];

/** 分類が確定しない場合に使うカテゴリ */
export const DEFAULT_PHOTO_CATEGORY: PhotoCategory = "その他";

/**
 * 投稿ID（SNS投稿）・記事slug（公式サイトの活動報告）ごとの、明示的なカテゴリ指定。
 * キーワード推定より優先されます。誤分類を見つけたらここへ追加してください。
 *
 * 投稿IDは src/data/socialPostsSnapshot.json の "id" をコピーします。
 */
export const photoCategoryOverrides: Record<string, PhotoCategory> = {
  // 2026-08-25 「新たに2か所、看板を設置しました！」
  "1282455044943687_122118395127398900": "看板設置",
  // 2026-08-15 「看板を設置しました！」
  "1282455044943687_122115573039398900": "看板設置",
  // 2026-07-28 「大野町意見交換会」
  "1282455044943687_122108696979398900": "意見交換",
  // 2026-07-23 「就労継続支援B型事業所延岡について」
  "1282455044943687_122105744385398900": "福祉活動",
  // 2026-07-22 「子どもの食の好き嫌いについての学びの会」
  "1282455044943687_122104470945398900": "イベント",
};

/**
 * キーワードからカテゴリを推定するための対応表。
 * 上から順に評価し、最初に一致したカテゴリを採用します。
 * 「その他」は推定対象に含めません（どれにも当てはまらなかった場合の受け皿のため）。
 */
const CATEGORY_KEYWORDS: { category: PhotoCategory; keywords: string[] }[] = [
  { category: "看板設置", keywords: ["看板", "ポスター"] },
  { category: "意見交換", keywords: ["意見交換", "座談会", "懇談", "対話集会"] },
  { category: "福祉活動", keywords: ["福祉", "介護", "障がい", "就労継続支援", "事業所", "とまりぎ荘"] },
  { category: "イベント", keywords: ["祭り", "まつり", "総会", "講演", "研修", "学びの会", "説明会"] },
  { category: "地域活動", keywords: ["地域", "清掃", "見守り", "町内", "自治会"] },
];

/** 活動報告記事の category 文字列を、写真カテゴリへ対応づける */
const ARTICLE_CATEGORY_MAP: Record<string, PhotoCategory> = {
  看板設置: "看板設置",
  地域活動: "地域活動",
  意見交換会: "意見交換",
  意見交換: "意見交換",
  福祉: "福祉活動",
  福祉活動: "福祉活動",
  介護: "福祉活動",
  イベント: "イベント",
};

/**
 * 写真のカテゴリを決定する。
 *
 * @param id        SNS投稿ID、または活動報告記事のslug
 * @param text      分類の手がかりになる文言（投稿タイトル・本文・記事タイトルなど）
 * @param articleCategory 活動報告記事の category（ある場合のみ）
 */
export function resolvePhotoCategory(
  id: string,
  text: string,
  articleCategory?: string,
): PhotoCategory {
  const override = photoCategoryOverrides[id];
  if (override) return override;

  if (articleCategory) {
    const mapped = ARTICLE_CATEGORY_MAP[articleCategory.trim()];
    if (mapped) return mapped;
  }

  for (const { category, keywords } of CATEGORY_KEYWORDS) {
    if (keywords.some((keyword) => text.includes(keyword))) return category;
  }

  return DEFAULT_PHOTO_CATEGORY;
}

/** 実際に写真があるカテゴリだけを、定義順で返す（0枚のカテゴリは表示しない） */
export function getPresentCategories(categories: PhotoCategory[]): PhotoCategory[] {
  const present = new Set(categories);
  return PHOTO_CATEGORIES.filter((category) => present.has(category));
}
