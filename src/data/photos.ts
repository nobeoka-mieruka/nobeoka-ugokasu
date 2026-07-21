// 活動写真（/photos）のデータです。
//
// 【写真を追加する方法】
// 下記の photos 配列に、オブジェクトを1件追加するだけで /photos ページに反映されます。
// image は public/images/photos/ 以下に配置したファイルへの絶対パス（例："/images/photos/2026-08-01-event.jpg"）
// を指定してください。実際に存在しない写真・架空の活動を追加しないでください。
//
// 例：
// {
//   date: "2026-08-01",
//   title: "地域の意見交換会にて",
//   description: "延岡市内で開催された意見交換会の様子です。",
//   image: "/images/photos/2026-08-01-event.jpg",
//   category: "市民との対話",
// }

export type PhotoCategory = "地域活動" | "市民との対話" | "福祉" | "子育て" | "勉強会" | "その他";

export interface PhotoItem {
  /** 撮影日・掲載日（"YYYY-MM-DD"形式）。不明な場合は省略可 */
  date?: string;
  title: string;
  description: string;
  /** public/images/photos/ 以下の画像への絶対パス */
  image: string;
  /** 画像の代替テキスト（altに使用）。省略時はtitleを使用 */
  alt?: string;
  category: PhotoCategory;
}

export const photoCategoryLabels: Record<PhotoCategory, string> = {
  "地域活動": "地域活動",
  "市民との対話": "市民との対話",
  "福祉": "福祉",
  "子育て": "子育て",
  "勉強会": "勉強会",
  "その他": "その他",
};

// 実在する写真が確認できるまでは空のままにしてください。
export const photos: PhotoItem[] = [];

export function getSortedPhotos(): PhotoItem[] {
  return [...photos].sort((a, b) => {
    if (!a.date) return 1;
    if (!b.date) return -1;
    return new Date(b.date).getTime() - new Date(a.date).getTime();
  });
}
