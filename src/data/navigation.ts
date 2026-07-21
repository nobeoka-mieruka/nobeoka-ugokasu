// ヘッダー・フッターのナビゲーション項目（7章・32章）

export type NavItem = {
  label: string;
  href: string;
};

// /videosページはYouTube連携が未設定の間も「動画は準備中です」を表示できるため、
// 他のメニュー項目と同様、常にナビゲーションへ含める。
const videoNavItem: NavItem = { label: "動画", href: "/videos/" };

const cityGuideNavItem: NavItem = { label: "市役所案内", href: "/city-guide/" };

export const headerNav: NavItem[] = [
  { label: "ホーム", href: "/" },
  { label: "福富千恵について", href: "/profile/" },
  { label: "私たちの提言", href: "/vision/" },
  { label: "活動報告", href: "/activities/" },
  { label: "みんなの声", href: "/voices/" },
  videoNavItem,
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
  { label: "みんなの声", href: "/voices/" },
  videoNavItem,
  cityGuideNavItem,
  { label: "後援会について", href: "/supporters/" },
  { label: "後援会に入会する", href: "/supporters/join/" },
  { label: "よくある質問", href: "/faq/" },
  { label: "お問い合わせ", href: "/contact/" },
  { label: "プライバシーポリシー", href: "/privacy/" },
  { label: "サイト利用について", href: "/terms/" },
];
