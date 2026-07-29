// 活動写真ページ（/photos）で、ページ読み込み後に /api/social-feed から取得した最新のSNS投稿を
// 写真グリッドへ差し込むための処理です。ビルド時点でSSR済みの写真（permalinkが一致するもの）は
// 除外し、日付の新しい順を保った位置へ挿入します。JavaScriptが無効な環境では、ビルド時点で
// 出力済みの写真がそのまま表示され続けるだけで、エラーにはなりません。

import type { SocialPost } from "../types/social";
import { resolveActivityImage } from "../utils/activityImage";
import { socialPlatformMeta } from "../config/socialPlatformMeta";
import { buildSocialPhotoAlt, buildSocialPhotoDescription } from "../utils/socialPhotoText";
import { svgIcon, formatDateLabel } from "./socialPostCard";

/** グリッド内の既存カードが持つpermalink（重複判定用）の集合を作る */
export function getExistingPhotoPermalinks(grid: HTMLElement): Set<string> {
  const set = new Set<string>();
  grid.querySelectorAll<HTMLElement>("[data-photo-permalink]").forEach((el) => {
    const permalink = el.dataset.photoPermalink;
    if (permalink) set.add(permalink);
  });
  return set;
}

/** 日付（ISO文字列）を基準に、新しい順を保ったままカードをグリッドへ挿入する */
export function insertPhotoCardSorted(grid: HTMLElement, card: HTMLElement, dateIso: string) {
  const time = new Date(dateIso).getTime();
  const children = Array.from(grid.children) as HTMLElement[];
  const before = children.find((child) => {
    const childTime = child.dataset.photoDate ? new Date(child.dataset.photoDate).getTime() : 0;
    return childTime < time;
  });
  if (before) {
    grid.insertBefore(card, before);
  } else {
    grid.append(card);
  }
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  return node;
}

/**
 * SNS投稿1件分の写真カードを組み立てる。画像URLが確認できない投稿（テキストのみ・
 * サムネイル無しの動画等）はnullを返す（呼び出し側は追加しない）。
 * DOM構造・クラスは src/pages/photos/index.astro のSSR側と同じものにし、見た目を統一している。
 */
export function createSocialPhotoCardElement(post: SocialPost): HTMLElement | null {
  const resolved = resolveActivityImage(post);
  if (!resolved) return null;

  const meta = socialPlatformMeta[post.platform];
  const description = buildSocialPhotoDescription(post.description, post.platform);
  const alt = buildSocialPhotoAlt(post.description, post.platform);

  const card = el("a", "card p-0 overflow-hidden flex flex-col h-full min-w-0 hover:shadow-md transition-shadow");
  card.href = post.permalink;
  card.target = "_blank";
  card.rel = "noopener noreferrer";
  card.dataset.photoCard = "";
  card.dataset.photoSource = post.platform;
  card.dataset.photoPermalink = post.permalink;
  card.dataset.photoDate = post.publishedAt;
  card.setAttribute("aria-label", `${meta.label}の元の投稿を見る`);

  const mediaBox = el("div", "aspect-[4/3] w-full overflow-hidden bg-brand-orange-light");
  const img = document.createElement("img");
  img.src = resolved.src;
  img.alt = alt;
  img.width = 640;
  img.height = 480;
  img.loading = "lazy";
  img.decoding = "async";
  img.className = "h-full w-full object-cover";
  img.dataset.socialPhoto = "";
  mediaBox.append(img);
  card.append(mediaBox);

  const body = el("div", "p-5 flex flex-col gap-2 flex-1");

  const metaRow = el("div", "flex items-center gap-2 text-sm text-ink-soft");
  const badge = el("span", `inline-flex items-center gap-1 rounded-full px-2.5 py-1 font-bold ${meta.badgeClass}`);
  badge.append(svgIcon(meta.icon, "w-3.5 h-3.5"), document.createTextNode(meta.badgeLabel));
  metaRow.append(badge);

  const dateLabel = formatDateLabel(post.publishedAt);
  if (dateLabel) {
    const time = document.createElement("time");
    time.dateTime = post.publishedAt;
    time.textContent = dateLabel;
    metaRow.append(time);
  }
  body.append(metaRow);

  const desc = el("p", "text-sm text-ink-soft line-clamp-3");
  desc.textContent = description;
  body.append(desc);

  const linkLabel = el("span", "mt-auto inline-flex items-center gap-1 text-sm font-bold text-brand-orange-dark");
  linkLabel.append(document.createTextNode(`${meta.label}で投稿を見る`), svgIcon("externalLink", "w-3.5 h-3.5"));
  const srOnly = el("span", "sr-only");
  srOnly.textContent = "（新しいタブで開く）";
  linkLabel.append(srOnly);
  body.append(linkLabel);

  card.append(body);
  return card;
}

let fallbackRegistered = false;

/**
 * SNS画像（Facebook等の外部URLは期限切れになりうる）の読み込みに失敗した場合、壊れた画像
 * アイコンを残さず、カードごと非表示にする。SSR済みの<img>・ここで動的に追加した<img>の
 * 両方に、イベント委譲で一括対応する（複数回呼ばれても登録は1回だけ）。
 */
export function registerSocialPhotoFallback() {
  if (fallbackRegistered) return;
  fallbackRegistered = true;

  document.addEventListener(
    "error",
    (event) => {
      const img = event.target;
      if (!(img instanceof HTMLImageElement) || !img.matches("[data-social-photo]")) return;
      const card = img.closest<HTMLElement>("[data-photo-card]");
      if (!card) return;
      card.classList.add("hidden");
      card.setAttribute("aria-hidden", "true");
    },
    true,
  );
}
