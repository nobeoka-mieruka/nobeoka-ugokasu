// ヘッダー・フッターのナビゲーション項目（7章・32章）

import { videos } from "./videos";

export type NavItem = {
  label: string;
  href: string;
};

/**
 * 動画メニューの表示条件。
 * 掲載できる動画が1本も無い間は、メニューから「動画」を一時的に外す
 * （中身が準備中のページへ誘導しないため）。
 *
 * src/data/videos.ts へ動画を1本追加すれば、この判定によって
 * ヘッダー・フッターの両方へ自動的に「動画」メニューが復活します。
 * /videos/ ページ自体は常に存在し続けるため、URLは変わらず404にもなりません。
 */
const hasPublishedVideos = videos.length > 0;

const videoNavItem: NavItem = { label: "動画", href: "/videos/" };

const cityGuideNavItem: NavItem = { label: "市役所案内", href: "/city-guide/" };
const photosNavItem: NavItem = { label: "活動写真", href: "/photos/" };

export const headerNav: NavItem[] = [
  { label: "ホーム", href: "/" },
  { label: "福富千恵について", href: "/profile/" },
  { label: "私たちの提言", href: "/vision/" },
  { label: "活動報告", href: "/activities/" },
  { label: "みんなの声", href: "/voices/" },
  ...(hasPublishedVideos ? [videoNavItem] : []),
  cityGuideNavItem,
  { label: "後援会について", href: "/supporters/" },
  { label: "後援会に入会する", href: "/supporters/join/" },
  { label: "お問い合わせ", href: "/contact/" },
];

export const footerNav: NavItem[] = [
  { label: "ホーム", href: "/" },
  { label: "福富千恵について", href: "/profile/" },
  { label: "私たちの提言", href: "/vision/" },
  { label: "活動報告", href: "/activities/" },
  photosNavItem,
  { label: "みんなの声", href: "/voices/" },
  ...(hasPublishedVideos ? [videoNavItem] : []),
  cityGuideNavItem,
  { label: "後援会について", href: "/supporters/" },
  { label: "後援会に入会する", href: "/supporters/join/" },
  { label: "よくある質問", href: "/faq/" },
  { label: "お問い合わせ", href: "/contact/" },
  { label: "プライバシーポリシー", href: "/privacy/" },
  { label: "サイト利用について", href: "/terms/" },
];
