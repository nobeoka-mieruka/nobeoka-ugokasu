// SNSから自動取得した投稿カードをブラウザ側で組み立てるモジュールです。
// Astroコンポーネント（.astro）はビルド時にしかレンダリングされないため、
// ページ読み込み後にAPIから届く投稿はこの純粋なDOM生成関数で描画します。
// 投稿本文・captionは必ず textContent で挿入し、HTMLとして解釈させません。

import type { SocialPost } from "../types/social";

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

const PLATFORM_META = {
  facebook: {
    label: "Facebook",
    badgeLabel: "公式Facebook",
    icon: "facebook" as const,
    badgeClass: ["bg-sns-facebook", "text-white"],
    buttonClass: ["bg-sns-facebook", "text-white", "hover:brightness-110"],
  },
  instagram: {
    label: "Instagram",
    badgeLabel: "公式Instagram",
    icon: "instagram" as const,
    badgeClass: ["bg-gradient-to-r", "from-[#833AB4]", "to-[#C1266E]", "text-white"],
    buttonClass: ["bg-gradient-to-r", "from-[#833AB4]", "to-[#C1266E]", "text-white", "hover:brightness-110"],
  },
};

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
  const meta = PLATFORM_META[post.platform];

  const wrapper = el("div", "card p-0 overflow-hidden flex flex-col h-full");
  wrapper.setAttribute("data-activity-card", "");
  wrapper.setAttribute("data-platforms", post.platform);

  // ---- 画像 / サムネイル / Facebook埋め込み ----
  if (post.platform === "facebook") {
    // FacebookはGraph APIの画像URLを転載せず、公式のXFBML埋め込み（.fb-post）で表示する。
    // 実際の生成・遅延読み込みは src/scripts/facebookEmbed.ts の observeFacebookEmbeds() が
    // ページ内の [data-fb-embed-root] を監視して行う。
    const mediaBox = el("div", "relative overflow-hidden flex justify-center min-h-[200px] sm:min-h-60");
    mediaBox.dataset.fbEmbedRoot = "";
    mediaBox.dataset.fbEmbedHref = post.permalink;

    const slot = el("div", "w-full flex justify-center py-4");
    slot.setAttribute("data-fb-embed-slot", "");

    const placeholder = el(
      "div",
      "absolute inset-0 flex items-center justify-center bg-brand-orange-light text-brand-orange-dark",
      [svgIcon("document", "w-10 h-10")],
    );
    placeholder.setAttribute("data-fb-embed-placeholder", "");

    mediaBox.append(slot, placeholder);
    wrapper.append(mediaBox);
  } else {
    const mediaBox = el("div", "h-[200px] sm:h-60 bg-brand-orange-light overflow-hidden relative");
    const displaySrc = post.imageUrl ?? post.thumbnailUrl;

    function renderFallbackIcon() {
      mediaBox.replaceChildren(
        el("div", "w-full h-full flex items-center justify-center text-brand-orange-dark", [
          svgIcon("document", "w-10 h-10"),
        ]),
      );
    }

    if (displaySrc) {
      const img = document.createElement("img");
      img.src = displaySrc;
      img.alt = post.title;
      img.loading = "lazy";
      img.className = "w-full h-full object-cover object-center";
      img.width = 640;
      img.height = 360;
      // 画像URLの期限切れ等で読み込みに失敗しても、カード自体は崩れないようにする
      img.addEventListener("error", renderFallbackIcon, { once: true });
      mediaBox.append(img);

      if (post.mediaType === "VIDEO" || post.mediaType === "REELS") {
        const playOverlay = el("div", "absolute inset-0 flex items-center justify-center pointer-events-none", [
          el("span", "rounded-full bg-black/50 p-3 text-white", [svgIcon("play", "w-6 h-6")]),
        ]);
        mediaBox.append(playOverlay);
      }
    } else {
      renderFallbackIcon();
    }

    wrapper.append(mediaBox);
  }

  // ---- 本文エリア ----
  const body = el("div", "p-6 flex flex-col gap-3 flex-1");

  const metaRow = el("div", "flex items-center gap-2 text-sm text-ink-soft");
  const badge = el("span", `inline-flex items-center gap-1 rounded-full px-2.5 py-1 font-bold ${meta.badgeClass.join(" ")}`, [
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
    continueLink.textContent = "続きを読む →";
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
  viewLink.className = `inline-flex items-center gap-1.5 rounded-full px-4 py-2 text-sm font-bold transition-all ${meta.buttonClass.join(" ")}`;
  viewLink.append(svgIcon(meta.icon, "w-4 h-4"), document.createTextNode(`${meta.label}で見る`));
  const srOnlyView = el("span", "sr-only");
  srOnlyView.textContent = "（新しいタブで開く）";
  viewLink.append(srOnlyView, svgIcon("externalLink", "w-3.5 h-3.5"));
  actions.append(viewLink);
  body.append(actions);

  wrapper.append(body);

  return wrapper;
}
