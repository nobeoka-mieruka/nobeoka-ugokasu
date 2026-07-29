// Facebook/Instagram投稿カードの見た目（バッジ・ボタンの配色等）を1箇所で管理します。
// ビルド時のAstroコンポーネント（SocialPostCard.astro / SnsActivityCard.astro）と、
// ブラウザ実行時にカードを組み立てるスクリプト（src/scripts/socialPostCard.ts）の
// 両方から同じ定義を読み込むことで、表示の共通化・二重管理の防止を図っています。

export type SocialPlatformKey = "facebook" | "instagram" | "threads";

export interface SocialPlatformMeta {
  label: string;
  badgeLabel: string;
  icon: "facebook" | "instagram" | "threads";
  badgeClass: string;
  buttonClass: string;
}

export const socialPlatformMeta: Record<SocialPlatformKey, SocialPlatformMeta> = {
  facebook: {
    label: "Facebook",
    badgeLabel: "公式Facebook",
    icon: "facebook",
    badgeClass: "bg-sns-facebook text-white",
    buttonClass: "bg-sns-facebook text-white hover:brightness-110",
  },
  // Instagramらしい紫→ピンクのグラデーション。実際のロゴに使われる黄〜オレンジの帯は
  // 白文字とのコントラスト比が4.5:1未満になるため、あえて含めていません（WCAG AA基準）。
  instagram: {
    label: "Instagram",
    badgeLabel: "公式Instagram",
    icon: "instagram",
    badgeClass: "bg-gradient-to-r from-[#833AB4] to-[#C1266E] text-white",
    buttonClass: "bg-gradient-to-r from-[#833AB4] to-[#C1266E] text-white hover:brightness-110",
  },
  // Threadsの公式ブランドカラー（黒）に合わせ、サイト共通のink色を使用（白文字とのコントラスト比は十分）。
  threads: {
    label: "Threads",
    badgeLabel: "公式Threads",
    icon: "threads",
    badgeClass: "bg-ink text-white",
    buttonClass: "bg-ink text-white hover:brightness-110",
  },
};
