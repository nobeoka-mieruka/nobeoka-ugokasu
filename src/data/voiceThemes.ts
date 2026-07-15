// みんなの声：意見募集テーマ（12-2章準拠）
// 架空の募集期間は設定していません。実際に募集を開始する際、status と period を更新してください。

import type { ThemeStatusLabel } from "../config/voicesConfig";

export type VoiceTheme = {
  slug: string;
  title: string;
  category: string;
  status: ThemeStatusLabel;
  /** 募集期間（未確定のため空欄。実際の開始が決まり次第設定） */
  period: string;
  description: string;
};

export const voiceThemes: VoiceTheme[] = [
  { slug: "welfare-care", title: "福祉、介護", category: "福祉、介護", status: "準備中", period: "", description: "福祉・介護に関するお困りごとやご意見を募集します。" },
  { slug: "disability-welfare", title: "障がい福祉", category: "障がい福祉", status: "準備中", period: "", description: "障がい福祉に関するお困りごとやご意見を募集します。" },
  { slug: "childcare-education", title: "子育て、教育", category: "子育て、教育", status: "準備中", period: "", description: "子育て・教育に関するお困りごとやご意見を募集します。" },
  { slug: "elderly-support", title: "高齢者支援", category: "高齢者支援", status: "準備中", period: "", description: "高齢者支援に関するお困りごとやご意見を募集します。" },
  { slug: "disaster-prevention", title: "防災、避難", category: "防災、避難", status: "準備中", period: "", description: "防災・避難に関するお困りごとやご意見を募集します。" },
  { slug: "local-transport", title: "地域交通", category: "地域交通", status: "準備中", period: "", description: "地域交通に関するお困りごとやご意見を募集します。" },
  { slug: "shopping-living-environment", title: "買い物、生活環境", category: "買い物、生活環境", status: "準備中", period: "", description: "買い物・生活環境に関するお困りごとやご意見を募集します。" },
  { slug: "work-local-economy", title: "仕事、地域経済", category: "仕事、地域経済", status: "準備中", period: "", description: "仕事・地域経済に関するお困りごとやご意見を募集します。" },
  { slug: "administrative-procedures", title: "行政手続き", category: "行政手続き", status: "準備中", period: "", description: "行政手続きに関するお困りごとやご意見を募集します。" },
  { slug: "local-community", title: "地域コミュニティ", category: "地域コミュニティ", status: "準備中", period: "", description: "地域コミュニティに関するお困りごとやご意見を募集します。" },
  { slug: "future-of-nobeoka", title: "延岡の将来", category: "延岡の将来", status: "準備中", period: "", description: "延岡の将来に関するご意見・アイデアを募集します。" },
  { slug: "other", title: "その他", category: "その他", status: "準備中", period: "", description: "上記に当てはまらないご意見を募集します。" },
];

export function getVoiceTheme(slug: string): VoiceTheme | undefined {
  return voiceThemes.find((t) => t.slug === slug);
}
