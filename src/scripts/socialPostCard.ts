// SNSから自動取得した投稿カードをブラウザ側で組み立てるモジュールです。
// Astroコンポーネント（src/components/SocialPostCard.astro）はビルド時にしかレンダリングされない
// ため、ページ読み込み後にAPI（/api/social-feed）から届く投稿はこの純粋なDOM生成関数で描画します。
// 生成するDOM構造・クラスはSocialPostCard.astroと同じものにし、見た目を統一しています。
// 投稿本文・captionは必ず textContent で挿入し、HTMLとして解釈させません。

import type { SocialPost } from "../types/social";
import { socialPlatformMeta } from "../config/socialPlatformMeta";
import { resolveActivityImage, buildActivityImageAlt } from "../utils/activityImage";

const DESCRIPTION_MAX_LENGTH = 150;

const ICONS = {
  facebook: '<path d="M15 8h2V4.5h-2.5A4 4 0 0 0 10 8.5V11H8v3.5h2V21h3.5v-6.5H16l.5-3.5h-3V8.8c0-.5.2-.8.7-.8z"/>',
  instagram:
    '<rect x="3" y="3" width="18" height="18" rx="5"/><circle cx="12" cy="12" r="4"/><line x1="17.5" y1="6.5" x2="17.5" y2="6.51"/>',
  externalLink:
    '<path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/>',
  document:
    '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><polyline points="14 3 14 8 19 8"/><line x1="8" y1="13" x2="16" y2="13"/><line x1="8" y1="17" x2="16" y2="17"/>',
  play: '<circle cx="12" cy="12" r="10"/><polygon points="10 8 16 12 10 16 10 8"/>',
};

/** 固定の自作SVGアイコンのみを描画する（利用者データは一切含めない） */
function svgIcon(name: keyof typeof ICONS, className: string): SVGSVGElement {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", "2");
  svg.setAttribute("stroke-linecap", "round");
  svg.setAttribute("stroke-linejoin", "round");
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("class", className);
  svg.innerHTML = ICONS[name];
  return svg;
}

function formatDateLabel(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString("ja-JP", { year: "numeric", month: "long", day: "numeric" });
}

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className: string,
  children: (Node | string)[] = [],
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  for (const child of children) {
    node.append(child);
  }
  return node;
}

/** 取得できた投稿を、既存の活動報告カードと統一感のあるカード要素として組み立てる */
export function createSocialPostCardElement(post: SocialPost, instagramUsername?: string): HTMLElement {
  const meta = socialPlatformMeta[post.platform];

  const wrapper = el("div", "card p-0 overflow-hidden flex flex-col h-full");
  wrapper.setAttribute("data-activity-card", "");
  wrapper.setAttribute("data-platforms", post.platform);

  // ---- 画像 / コンパクトフォールバック ----
  const resolvedImage = resolveActivityImage(post);
  const isVideoLike = post.mediaType === "VIDEO" || post.mediaType === "REELS";

  if (resolvedImage) {
    const mediaBox = el("div", "relative w-full aspect-[16/9] overflow-hidden bg-brand-orange-light");
    mediaBox.dataset.activityMedia = "";

    const img = document.createElement("img");
    img.src = resolvedImage.src;
    img.alt = buildActivityImageAlt(post.title);
    img.loading = "lazy";
    img.decoding = "async";
    img.className = "w-full h-full object-cover object-center";
    img.width = resolvedImage.width || 640;
    img.height = resolvedImage.height || 360;
    img.dataset.activityImage = "";
    mediaBox.append(img);

    const fallback = el("div", "hidden absolute inset-0 items-center justify-center text-brand-orange-dark", [
      svgIcon("document", "w-8 h-8"),
    ]);
    fallback.setAttribute("data-activity-image-fallback", "");
    mediaBox.append(fallback);
    // 画像URLの期限切れ等で読み込みに失敗した場合の処理は、ページ側で1回だけ登録される
    // registerActivityImageFallback()（イベント委譲）が行う。動的に追加したこの<img>にも
    // 同じ[data-activity-image]属性が付いているため、追加のリスナー登録は不要。

    if (isVideoLike) {
      const playOverlay = el("div", "absolute inset-0 flex items-center justify-center pointer-events-none", [
        el("span", "rounded-full bg-black/50 p-3 text-white", [svgIcon("play", "w-6 h-6")]),
      ]);
      mediaBox.append(playOverlay);
    }

    wrapper.append(mediaBox);
  } else {
    const mediaBox = el(
      "div",
      "w-full h-[72px] flex items-center justify-center bg-brand-orange-light text-brand-orange-dark",
      [svgIcon("document", "w-6 h-6")],
    );
    mediaBox.dataset.activityMedia = "";
    wrapper.append(mediaBox);
  }

  // ---- 本文エリア ----
  const body = el("div", "p-6 flex flex-col gap-3 flex-1");

  const metaRow = el("div", "flex items-center gap-2 text-sm text-ink-soft");
  const badge = el("span", `inline-flex items-center gap-1 rounded-full px-2.5 py-1 font-bold ${meta.badgeClass}`, [
    svgIcon(meta.icon, "w-3.5 h-3.5"),
    document.createTextNode(meta.badgeLabel),
  ]);
  metaRow.append(badge);

  if (post.platform === "instagram" && instagramUsername) {
    const usernameEl = document.createElement("span");
    usernameEl.className = "text-xs text-ink-soft";
    usernameEl.textContent = `@${instagramUsername}`;
    metaRow.append(usernameEl);
  }

  const dateLabel = formatDateLabel(post.publishedAt);
  if (dateLabel) {
    const time = document.createElement("time");
    time.dateTime = post.publishedAt;
    time.textContent = dateLabel;
    metaRow.append(time);
  }
  body.append(metaRow);

  const heading = el("h3", "text-xl font-bold text-ink leading-snug");
  heading.textContent = post.title;
  body.append(heading);

  const isTruncated = post.description.length > DESCRIPTION_MAX_LENGTH;
  const shownText = isTruncated ? `${post.description.slice(0, DESCRIPTION_MAX_LENGTH)}…` : post.description;
  if (shownText) {
    const desc = el("p", "text-base text-ink-soft");
    desc.textContent = shownText;
    body.append(desc);
  }

  if (isTruncated) {
    const continueLink = document.createElement("a");
    continueLink.href = post.permalink;
    continueLink.target = "_blank";
    continueLink.rel = "noopener noreferrer";
    continueLink.className = "text-sm font-bold text-ink underline w-fit";
    continueLink.append(document.createTextNode("続きを読む →"));
    const srOnly = el("span", "sr-only");
    srOnly.textContent = "（新しいタブで開く）";
    continueLink.append(srOnly);
    body.append(continueLink);
  }

  const actions = el("div", "mt-auto pt-2");
  const viewLink = document.createElement("a");
  viewLink.href = post.permalink;
  viewLink.target = "_blank";
  viewLink.rel = "noopener noreferrer";
  viewLink.className = `inline-flex items-center gap-1.5 rounded-full px-4 py-2 text-sm font-bold transition-all ${meta.buttonClass}`;
  viewLink.append(svgIcon(meta.icon, "w-4 h-4"), document.createTextNode(`${meta.label}で全文を見る`));
  viewLink.append(svgIcon("externalLink", "w-3.5 h-3.5"));
  const srOnlyView = el("span", "sr-only");
  srOnlyView.textContent = "（新しいタブで開く）";
  viewLink.append(srOnlyView);
  actions.append(viewLink);
  body.append(actions);

  wrapper.append(body);

  return wrapper;
}
