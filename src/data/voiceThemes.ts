// みんなの声：意見募集テーマ（12-2章準拠）
// 2026年7月、全12テーマの受付を開始しました。募集を一時停止・終了する場合は、
// 該当テーマの status を "準備中" または "募集終了" に変更してください。

import type { ThemeStatusLabel } from "../config/voicesConfig";

export type VoiceTheme = {
  slug: string;
  title: string;
  category: string;
  status: ThemeStatusLabel;
  /** 募集期間（未確定のため空欄。終了時期が決まり次第設定） */
  period: string;
  description: string;
  /** 詳細ページに表示する相談例（省略可） */
  examples?: string;
};

export const voiceThemes: VoiceTheme[] = [
  {
    slug: "welfare-care",
    title: "福祉、介護",
    category: "福祉、介護",
    status: "募集中",
    period: "",
    description: "福祉・介護に関するお困りごとやご意見を募集します。",
    examples: "介護サービス、家族介護、福祉制度など",
  },
  {
    slug: "disability-welfare",
    title: "障がい福祉",
    category: "障がい福祉",
    status: "募集中",
    period: "",
    description: "障がい福祉に関するお困りごとやご意見を募集します。",
    examples: "障がい福祉サービス、就労、生活支援など",
  },
  {
    slug: "childcare-education",
    title: "子育て、教育",
    category: "子育て、教育",
    status: "募集中",
    period: "",
    description: "子育て・教育に関するお困りごとやご意見を募集します。",
    examples: "保育、学校、子育て支援、教育環境など",
  },
  {
    slug: "elderly-support",
    title: "高齢者支援",
    category: "高齢者支援",
    status: "募集中",
    period: "",
    description: "高齢者支援に関するお困りごとやご意見を募集します。",
    examples: "見守り、移動、買い物、孤立防止など",
  },
  {
    slug: "disaster-prevention",
    title: "防災、避難",
    category: "防災、避難",
    status: "募集中",
    period: "",
    description: "防災・避難に関するお困りごとやご意見を募集します。",
    examples: "避難所、防災情報、災害時の支援など",
  },
  {
    slug: "local-transport",
    title: "地域交通",
    category: "地域交通",
    status: "募集中",
    period: "",
    description: "地域交通に関するお困りごとやご意見を募集します。",
    examples: "バス、タクシー、移動手段、交通空白地域など",
  },
  {
    slug: "shopping-living-environment",
    title: "買い物、生活環境",
    category: "買い物、生活環境",
    status: "募集中",
    period: "",
    description: "買い物・生活環境に関するお困りごとやご意見を募集します。",
    examples: "買い物支援、ごみ、道路、生活環境など",
  },
  {
    slug: "work-local-economy",
    title: "仕事、地域経済",
    category: "仕事、地域経済",
    status: "募集中",
    period: "",
    description: "仕事・地域経済に関するお困りごとやご意見を募集します。",
    examples: "雇用、事業者支援、商店街、地域産業など",
  },
  {
    slug: "administrative-procedures",
    title: "行政手続き",
    category: "行政手続き",
    status: "募集中",
    period: "",
    description: "行政手続きに関するお困りごとやご意見を募集します。",
    examples: "市役所での手続き、窓口、オンライン化など",
  },
  {
    slug: "local-community",
    title: "地域コミュニティ",
    category: "地域コミュニティ",
    status: "募集中",
    period: "",
    description: "地域コミュニティに関するお困りごとやご意見を募集します。",
    examples: "自治会、地域活動、交流の場など",
  },
  {
    slug: "future-of-nobeoka",
    title: "延岡の将来",
    category: "延岡の将来",
    status: "募集中",
    period: "",
    description: "延岡の将来に関するご意見・アイデアを募集します。",
    examples: "まちづくり、人口減少、若者定着、将来像など",
  },
  {
    slug: "other",
    title: "その他",
    category: "その他",
    status: "募集中",
    period: "",
    description: "上記に当てはまらないご意見を募集します。",
    examples: "ほかのテーマに該当しない意見や提案",
  },
];

export function getVoiceTheme(slug: string): VoiceTheme | undefined {
  return voiceThemes.find((t) => t.slug === slug);
}
