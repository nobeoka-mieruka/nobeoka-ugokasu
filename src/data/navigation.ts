// ヘッダー・フッターのナビゲーション項目（7章・32章）

import { videos } from "./videos";

export type NavItem = {
  label: string;
  href: string;
};

// 動画ページへのナビゲーションは、既存メニューを圧迫しないよう、
// 動画が1件以上登録されるまでは表示しません（videos配下参照）。
const videoNavItem: NavItem = { label: "動画", href: "/videos" };
const hasVideos = videos.length > 0;

const cityGuideNavItem: NavItem = { label: "市役所案内", href: "/city-guide" };

export const headerNav: NavItem[] = [
  { label: "ホーム", href: "/" },
  { label: "福富千恵について", href: "/profile" },
  { label: "私たちの提言", href: "/vision" },
  { label: "活動報告", href: "/activities" },
  { label: "みんなの声", href: "/voices" },
  ...(hasVideos ? [videoNavItem] : []),
  cityGuideNavItem,
  { label: "後援会について", href: "/supporters" },
  { label: "後援会に入会する", href: "/supporters/join" },
  { label: "お問い合わせ", href: "/contact" },
];

export const footerNav: NavItem[] = [
  { label: "ホーム", href: "/" },
  { label: "福富千恵について", href: "/profile" },
  { label: "私たちの提言", href: "/vision" },
  { label: "活動報告", href: "/activities" },
  { label: "みんなの声", href: "/voices" },
  ...(hasVideos ? [videoNavItem] : []),
  cityGuideNavItem,
  { label: "後援会について", href: "/supporters" },
  { label: "後援会に入会する", href: "/supporters/join" },
  { label: "よくある質問", href: "/faq" },
  { label: "お問い合わせ", href: "/contact" },
  { label: "プライバシーポリシー", href: "/privacy" },
  { label: "サイト利用について", href: "/terms" },
];
