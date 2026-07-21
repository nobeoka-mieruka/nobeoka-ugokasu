// YouTube Data APIから自動取得した動画カードをブラウザ側で組み立てるモジュールです。
// Astroコンポーネント（.astro）はビルド時にしかレンダリングされないため、
// ページ読み込み後にAPIから届く動画はこの純粋なDOM生成関数で描画します。
// 動画のタイトル・説明文は必ずtextContentで挿入し、HTMLとして解釈させません。
// サムネイルをクリックするとYouTube側で開くだけで、埋め込み再生・自動再生は行いません。

import type { YoutubeVideo } from "../types/youtube";

const DESCRIPTION_MAX_LENGTH = 120;

const ICONS = {
  youtube: '<rect x="3" y="5" width="18" height="14" rx="4"/><path d="M10.5 9.5l4.5 2.5-4.5 2.5v-5z" fill="currentColor" stroke="currentColor" stroke-linejoin="round"/>',
  play: '<circle cx="12" cy="12" r="9"/><path d="M10 8.5l6 3.5-6 3.5v-7z" fill="currentColor" stroke="currentColor" stroke-linejoin="round"/>',
  externalLink:
    '<path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/>',
  document:
    '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><polyline points="14 3 14 8 19 8"/><line x1="8" y1="13" x2="16" y2="13"/><line x1="8" y1="17" x2="16" y2="17"/>',
};

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

/** 取得できた動画を、既存の活動報告カードと統一感のあるカード要素として組み立てる */
export function createYoutubeVideoCardElement(video: YoutubeVideo): HTMLElement {
  const wrapper = el("div", "card p-0 overflow-hidden flex flex-col h-full");
  wrapper.setAttribute("data-video-card", "");
  wrapper.setAttribute("data-platforms", "youtube");

  // ---- サムネイル（クリックでYouTubeを新しいタブで開く。埋め込み再生はしない） ----
  const mediaLink = document.createElement("a");
  mediaLink.href = video.videoUrl;
  mediaLink.target = "_blank";
  mediaLink.rel = "noopener noreferrer";
  mediaLink.className = "aspect-[16/9] bg-ink/10 overflow-hidden relative block group";
  mediaLink.setAttribute("aria-label", `YouTubeで再生：${video.title}`);

  function renderFallbackIcon() {
    mediaLink.replaceChildren(
      el("div", "w-full h-full flex items-center justify-center text-brand-orange-dark", [
        svgIcon("document", "w-10 h-10"),
      ]),
    );
  }

  if (video.thumbnailUrl) {
    const img = document.createElement("img");
    img.src = video.thumbnailUrl;
    img.alt = "";
    img.loading = "lazy";
    img.decoding = "async";
    img.className = "w-full h-full object-cover";
    img.width = 640;
    img.height = 360;
    img.addEventListener("error", renderFallbackIcon, { once: true });
    mediaLink.append(img);

    const overlay = el("span", "absolute inset-0 bg-black/25 transition-colors group-hover:bg-black/35");
    const playBadge = el("span", "absolute inset-0 flex items-center justify-center", [
      el("span", "rounded-full bg-white/90 p-3 text-brand-orange-dark shadow-md transition-transform group-hover:scale-105", [
        svgIcon("play", "w-7 h-7"),
      ]),
    ]);
    mediaLink.append(overlay, playBadge);
  } else {
    renderFallbackIcon();
  }

  wrapper.append(mediaLink);

  // ---- 本文エリア ----
  const body = el("div", "p-6 flex flex-col gap-3 flex-1");

  const metaRow = el("div", "flex items-center gap-2 text-sm text-ink-soft");
  const badge = el("span", "inline-flex items-center gap-1 rounded-full px-2.5 py-1 font-bold bg-[#FF0000] text-white", [
    svgIcon("youtube", "w-3.5 h-3.5"),
    document.createTextNode("YouTube"),
  ]);
  metaRow.append(badge);

  const dateLabel = formatDateLabel(video.publishedAt);
  if (dateLabel) {
    const time = document.createElement("time");
    time.dateTime = video.publishedAt;
    time.textContent = dateLabel;
    metaRow.append(time);
  }
  body.append(metaRow);

  const heading = el("h3", "text-xl font-bold text-ink leading-snug");
  heading.textContent = video.title;
  body.append(heading);

  const description = video.description.trim();
  const isTruncated = description.length > DESCRIPTION_MAX_LENGTH;
  const shownText = isTruncated ? `${description.slice(0, DESCRIPTION_MAX_LENGTH)}…` : description;
  if (shownText) {
    const desc = el("p", "text-base text-ink-soft");
    desc.textContent = shownText;
    body.append(desc);
  }

  const actions = el("div", "mt-auto pt-2");
  const viewLink = document.createElement("a");
  viewLink.href = video.videoUrl;
  viewLink.target = "_blank";
  viewLink.rel = "noopener noreferrer";
  viewLink.className =
    "inline-flex items-center gap-1.5 rounded-full px-4 py-2 text-sm font-bold transition-all bg-[#FF0000] text-white hover:brightness-110";
  viewLink.append(svgIcon("youtube", "w-4 h-4"), document.createTextNode("YouTubeで見る"));
  const srOnlyView = el("span", "sr-only");
  srOnlyView.textContent = "（新しいタブで開く）";
  viewLink.append(srOnlyView, svgIcon("externalLink", "w-3.5 h-3.5"));
  actions.append(viewLink);
  body.append(actions);

  wrapper.append(body);

  return wrapper;
}
