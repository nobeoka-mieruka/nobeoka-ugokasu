// 活動報告カード（Facebook/Instagram投稿）の画像読み込みに失敗したときの共通処理です。
// ビルド時にAstroが出力したカード（SocialPostCard.astro）と、ページ読み込み後にJSが
// 追加するカード（src/scripts/socialPostCard.ts）の両方で同じ見た目・挙動になるよう、
// ここに1箇所だけ実装します。
//
// 失敗時は、大きな画像領域をそのまま空白で残さず、コンパクトな高さのアイコン表示に
// 切り替えます（[data-activity-media] のmodifierクラスを差し替えるだけで、
// レイアウト用のクラス自体はAstro側テンプレートと共有しています）。

const COMPACT_MEDIA_CLASSES = ["h-[72px]", "flex", "items-center", "justify-center"];
const IMAGE_MEDIA_CLASSES = ["aspect-[16/9]"];

/** 画像を除去し、メディア領域をコンパクトなアイコン表示へ切り替える */
export function collapseActivityMediaToCompact(media: HTMLElement, img?: HTMLImageElement | null) {
  img?.remove();
  media.classList.remove(...IMAGE_MEDIA_CLASSES);
  media.classList.add(...COMPACT_MEDIA_CLASSES);
  const fallback = media.querySelector<HTMLElement>("[data-activity-image-fallback]");
  fallback?.classList.remove("hidden");
  fallback?.classList.add("flex");
}

let registered = false;

/**
 * ビルド時に出力された[data-activity-image]のonerrorを、イベント委譲で一括して処理する。
 * 複数ページ・複数コンポーネントから呼ばれても、実際の登録は1回だけ行う。
 */
export function registerActivityImageFallback() {
  if (registered) return;
  registered = true;

  document.addEventListener(
    "error",
    (event) => {
      const img = event.target;
      if (!(img instanceof HTMLImageElement) || !img.matches("[data-activity-image]")) return;
      const media = img.closest<HTMLElement>("[data-activity-media]");
      if (!media) return;
      collapseActivityMediaToCompact(media, img);
    },
    true,
  );
}
