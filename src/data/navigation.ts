// ヘッダー・フッターのナビゲーション項目（7章・32章）

export type NavItem = {
  label: string;
  href: string;
};

export const headerNav: NavItem[] = [
  { label: "ホーム", href: "/" },
  { label: "福富千恵について", href: "/profile" },
  { label: "私たちの提言", href: "/vision" },
  { label: "活動報告", href: "/activities" },
  { label: "みんなの声", href: "/voices" },
  { label: "後援会について", href: "/supporters" },
  { label: "お問い合わせ", href: "/contact" },
];

export const footerNav: NavItem[] = [
  { label: "ホーム", href: "/" },
  { label: "福富千恵について", href: "/profile" },
  { label: "私たちの提言", href: "/vision" },
  { label: "活動報告", href: "/activities" },
  { label: "みんなの声", href: "/voices" },
  { label: "後援会について", href: "/supporters" },
  { label: "よくある質問", href: "/faq" },
  { label: "お問い合わせ", href: "/contact" },
  { label: "プライバシーポリシー", href: "/privacy" },
  { label: "サイト利用について", href: "/terms" },
];
