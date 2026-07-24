// Facebook投稿の画像は、通常の活動写真（人物・現場の様子）だけでなく、
// チラシ・ポスター・書籍の表紙・プロフィールカードのような文字情報が中心の画像も
// 投稿されます。後者を object-fit: cover でトリミングすると、肝心の文字や日付が
// 見切れてしまうため、投稿ID単位で表示方法を上書きできるようにしています。
//
// 【使い方】
// Facebook投稿ID（例: "1282455044943687_122105744385398900"。/api/social-feed の
// レスポンスや src/data/socialPostsSnapshot.json のpost.idで確認できます）をキーに、
// 必要な項目だけを指定してください。指定が無い投稿は既定値（cover・center）のまま
// 表示されます。
//
// - imageFit: "cover"（既定・写真向け） | "contain"（チラシ・文字入り画像向け）
// - imagePosition: object-position に渡すCSS値（例: "center", "top"）。省略時は"center"
// - imageAlt: 自動生成される代替テキストの代わりに使う、画像の内容が分かる説明文

export interface ActivityImageOverride {
  imageFit?: "cover" | "contain";
  imagePosition?: string;
  imageAlt?: string;
}

export const activityImageOverrides: Record<string, ActivityImageOverride> = {
  // 2026年6月の活動報告まとめ（スマホ画面のモックアップに文字を大きく載せたグラフィック）
  "1282455044943687_122105744385398900": {
    imageFit: "contain",
    imageAlt: "2026年6月の活動報告をまとめた画像（多職種会議、定時総会、感染症についての講演会の様子）",
  },
  // 「いちばんやさしい保育者のための『食べない子』サポートBOOK」の書影＋講演会参加報告
  "1282455044943687_122104470945398900": {
    imageFit: "contain",
    imageAlt: "延岡市子ども発達支援講演会に参加した際の書籍紹介画像（『食べない子』サポートBOOK）",
  },
  // 「社会を明るくする運動」延岡市推進委員会の案内ポスター（イラスト＋見出し文字）
  "1282455044943687_122104470681398900": {
    imageFit: "contain",
    imageAlt: "第76回社会を明るくする運動延岡市推進委員会の案内ポスター（保護司になるなんて、思ってもみなかった。）",
  },
  // 意見交換会の様子の写真に、お礼の文字とカテゴリバッジを重ねたグラフィック
  "1282455044943687_122104470243398900": {
    imageFit: "contain",
    imageAlt: "意見交換会にて参加者へ説明する福富千恵の様子",
  },
  // 福富千恵のプロフィール（学歴・資格・経験）をまとめたカード画像
  "1282455044943687_122104469889398900": {
    imageFit: "contain",
    imageAlt: "福富千恵のプロフィール（学歴・資格・経験）をまとめた画像",
  },
};

/** 投稿IDに対応する上書き設定を返す（無ければundefined＝既定値を使う） */
export function getActivityImageOverride(postId: string): ActivityImageOverride | undefined {
  return activityImageOverrides[postId];
}
