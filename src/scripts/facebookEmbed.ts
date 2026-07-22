// Facebook公式のXFBML埋め込み（.fb-post）を扱う共通処理です。
// SDK自体は活動報告ページで1回だけ読み込み（src/pages/activities/index.astro）、
// 各カードの埋め込みは画面に近づいたタイミングで遅延生成します。
// 埋め込みが一定時間内に描画されない場合は、カード側に用意したプレースホルダー
// （オレンジ色のアイコン。data-fb-embed-placeholder）を表示したままにします。

declare global {
  interface Window {
    FB?: {
      XFBML: {
        parse: (element?: Element) => void;
      };
    };
  }
}

const EMBED_TIMEOUT_MS = 8000;
const FB_READY_POLL_MS = 300;

function tryParse(element: Element): boolean {
  if (!window.FB?.XFBML) return false;
  window.FB.XFBML.parse(element);
  return true;
}

/** slot内にiframeが挿入されたら成功、EMBED_TIMEOUT_MS経っても現れなければ失敗として通知する */
function waitForRender(slot: HTMLElement, onSettled: (success: boolean) => void) {
  let settled = false;
  const settle = (success: boolean) => {
    if (settled) return;
    settled = true;
    observer.disconnect();
    window.clearTimeout(timeoutId);
    onSettled(success);
  };

  const observer = new MutationObserver(() => {
    if (slot.querySelector("iframe")) settle(true);
  });
  observer.observe(slot, { childList: true, subtree: true });

  const timeoutId = window.setTimeout(() => settle(false), EMBED_TIMEOUT_MS);
}

function activate(root: HTMLElement) {
  if (root.dataset.fbEmbedActivated === "true") return;
  root.dataset.fbEmbedActivated = "true";

  const href = root.dataset.fbEmbedHref;
  const slot = root.querySelector<HTMLElement>("[data-fb-embed-slot]");
  const placeholder = root.querySelector<HTMLElement>("[data-fb-embed-placeholder]");
  if (!href || !slot) return;

  const post = document.createElement("div");
  post.className = "fb-post";
  post.dataset.href = href;
  post.dataset.width = "500";
  post.dataset.showText = "true";
  slot.replaceChildren(post);

  waitForRender(slot, (success) => {
    if (success) {
      placeholder?.classList.add("hidden");
    } else {
      // 埋め込みに失敗した場合は空にして、既存のプレースホルダー表示のままにする
      slot.replaceChildren();
    }
  });

  if (!tryParse(post)) {
    // FacebookのJS SDKがまだ読み込み中の場合は、準備できるまで少し待って再試行する
    const retry = window.setInterval(() => {
      if (tryParse(post)) window.clearInterval(retry);
    }, FB_READY_POLL_MS);
    window.setTimeout(() => window.clearInterval(retry), EMBED_TIMEOUT_MS);
  }
}

/** data-fb-embed-root要素を画面に近づいたタイミングで検知し、順次Facebook埋め込みを読み込む */
export function observeFacebookEmbeds() {
  const targets = Array.from(document.querySelectorAll<HTMLElement>("[data-fb-embed-root]")).filter(
    (el) => el.dataset.fbEmbedActivated !== "true",
  );
  if (targets.length === 0) return;

  if (typeof IntersectionObserver === "undefined") {
    targets.forEach(activate);
    return;
  }

  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        activate(entry.target as HTMLElement);
        observer.unobserve(entry.target);
      });
    },
    { rootMargin: "300px 0px" },
  );

  targets.forEach((target) => observer.observe(target));
}

/** 絞り込み切り替え後などに、未描画の.fb-postが残っていないか念のため再パースする */
export function parseFacebookEmbeds() {
  window.FB?.XFBML.parse();
}
