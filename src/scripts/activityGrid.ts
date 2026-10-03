// 活動報告カードのグリッドへ、ページ読み込み後に取得したSNS投稿を差し込むための
// 共通処理です。トップページ・活動報告一覧ページの両方から使い、日付の新しい順を
// 保つ挿入位置の計算ロジックを1箇所にまとめています（文字列の単純比較ではなく、
// 必ず Date に変換してから比較します）。

/** グリッド内の既存カードが持つリンク先URL（重複判定用）の集合を作る */
export function getExistingActivityLinks(grid: HTMLElement): Set<string> {
  const set = new Set<string>();
  grid.querySelectorAll<HTMLAnchorElement>("[data-activity-card] a[href]").forEach((a) => {
    set.add(a.href);
  });
  return set;
}

/**
 * 最新のSNS投稿カードをグリッドへ反映する。
 * ・同じ投稿のカードが既にある場合：内容（画像・本文）が変わっていればカードを入れ替え、
 *   同じなら何もしない（ビルド時点の古い画像が残り続けることを防ぐ）
 * ・同じURLのカード（手動登録の活動報告など）がある場合：重複させない
 * ・どちらも無い場合：日付の新しい順の位置へ挿入する
 * 戻り値は、カードを追加・入れ替えした場合 true。
 */
export function upsertSocialPostCard(
  grid: HTMLElement,
  card: HTMLElement,
  permalink: string,
  knownLinks: Set<string>,
): boolean {
  const key = card.dataset.socialPostKey;
  const existing = key
    ? Array.from(grid.querySelectorAll<HTMLElement>("[data-social-post-key]")).find((el) => el.dataset.socialPostKey === key)
    : undefined;
  if (existing) {
    if (existing.dataset.socialSignature === card.dataset.socialSignature) return false;
    existing.replaceWith(card);
    return true;
  }
  if (knownLinks.has(permalink)) return false;
  insertActivityCardSorted(grid, card, card.dataset.date ?? "");
  knownLinks.add(permalink);
  return true;
}

/** 日付（ISO文字列）を基準に、新しい順を保ったままカードをグリッドへ挿入する */
export function insertActivityCardSorted(grid: HTMLElement, card: HTMLElement, dateIso: string) {
  const time = new Date(dateIso).getTime();
  const children = Array.from(grid.children) as HTMLElement[];
  const before = children.find((child) => {
    const childTime = child.dataset.date ? new Date(child.dataset.date).getTime() : 0;
    return childTime < time;
  });
  if (before) {
    grid.insertBefore(card, before);
  } else {
    grid.append(card);
  }
}
