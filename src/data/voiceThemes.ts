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
  /** 具体的なお困りごとの例（省略可） */
  troubleExamples?: string[];
  /** 改善してほしいことの例（省略可） */
  improvementExamples?: string[];
  /** 市民から寄せてほしい情報（省略可） */
  wantedInfo?: string;
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
    troubleExamples: [
      "介護保険サービスの利用方法が分かりにくい",
      "家族の介護と仕事の両立が難しい",
      "近くに相談できる窓口が少ない",
      "介護費用の負担が大きい",
    ],
    improvementExamples: [
      "介護に関する相談窓口をもっと分かりやすく案内してほしい",
      "家族介護者への支援を充実させてほしい",
    ],
    wantedInfo:
      "現在利用している（または利用したい）介護サービス、困った具体的な場面、延岡市内でのご経験などをお寄せください。",
  },
  {
    slug: "disability-welfare",
    title: "障がい福祉",
    category: "障がい福祉",
    status: "募集中",
    period: "",
    description: "障がい福祉に関するお困りごとやご意見を募集します。",
    examples: "障がい福祉サービス、就労、生活支援など",
    troubleExamples: [
      "障がい福祉サービスの申請手続きが複雑に感じる",
      "就労先や日中活動の場の選択肢が限られている",
      "災害時の支援体制に不安がある",
      "きょうだいや家族への支援が少ない",
    ],
    improvementExamples: [
      "障がいの種別や程度に応じた相談窓口を増やしてほしい",
      "就労・就学の選択肢を広げてほしい",
    ],
    wantedInfo:
      "利用している障がい福祉サービス、生活の中で感じている不便さ、必要としている支援の内容などをお寄せください。",
  },
  {
    slug: "childcare-education",
    title: "子育て、教育",
    category: "子育て、教育",
    status: "募集中",
    period: "",
    description: "子育て・教育に関するお困りごとやご意見を募集します。",
    examples: "保育、学校、子育て支援、教育環境など",
    troubleExamples: [
      "保育園・こども園の空きが少ない",
      "学童保育の利用時間や場所が限られている",
      "学校での相談先が分かりにくい",
      "子育てにかかる費用の負担が大きい",
    ],
    improvementExamples: [
      "保育・学童の受け皿を増やしてほしい",
      "学校や地域での相談体制を充実させてほしい",
    ],
    wantedInfo:
      "保育・教育の場で感じている困りごと、子育て支援制度についてのご意見、延岡市での子育て環境への要望などをお寄せください。",
  },
  {
    slug: "elderly-support",
    title: "高齢者支援",
    category: "高齢者支援",
    status: "募集中",
    period: "",
    description: "高齢者支援に関するお困りごとやご意見を募集します。",
    examples: "見守り、移動、買い物、孤立防止など",
    troubleExamples: [
      "一人暮らしの高齢者の見守りが十分でないと感じる",
      "買い物や通院の移動手段が少ない",
      "地域とのつながりが薄れて孤立しがち",
      "認知症に関する相談先が分かりにくい",
    ],
    improvementExamples: [
      "見守り・声かけの仕組みを充実させてほしい",
      "高齢者向けの移動支援を増やしてほしい",
    ],
    wantedInfo:
      "高齢のご家族やご自身の生活で感じている不安、見守りや移動、交流の場についてのご意見などをお寄せください。",
  },
  {
    slug: "disaster-prevention",
    title: "防災、避難",
    category: "防災、避難",
    status: "募集中",
    period: "",
    description: "防災・避難に関するお困りごとやご意見を募集します。",
    examples: "避難所、防災情報、災害時の支援など",
    troubleExamples: [
      "自分の地域の避難所がどこか分からない",
      "災害時の情報がどこで得られるか不安",
      "高齢者や障がいのある家族の避難方法に不安がある",
      "過去の災害時に困った経験がある",
    ],
    improvementExamples: [
      "避難所の情報をもっと分かりやすく発信してほしい",
      "地域ごとの防災訓練を増やしてほしい",
    ],
    wantedInfo:
      "お住まいの地域の防災上の不安や、実際に災害・避難時に困った経験、必要だと感じる支援などをお寄せください。",
  },
  {
    slug: "local-transport",
    title: "地域交通",
    category: "地域交通",
    status: "募集中",
    period: "",
    description: "地域交通に関するお困りごとやご意見を募集します。",
    examples: "バス、タクシー、移動手段、交通空白地域など",
    troubleExamples: [
      "バスの本数が少なく利用しづらい",
      "自動車を運転できないと移動が難しい",
      "公共交通の空白地域がある",
      "夜間・休日の移動手段が限られている",
    ],
    improvementExamples: [
      "バス路線やダイヤを地域の実情に合わせて見直してほしい",
      "高齢者や学生などが使いやすい移動支援を増やしてほしい",
    ],
    wantedInfo: "普段の移動で困っていること、バスやタクシーの利用状況、必要だと感じる交通手段などをお寄せください。",
  },
  {
    slug: "shopping-living-environment",
    title: "買い物、生活環境",
    category: "買い物、生活環境",
    status: "募集中",
    period: "",
    description: "買い物・生活環境に関するお困りごとやご意見を募集します。",
    examples: "買い物支援、ごみ、道路、生活環境など",
    troubleExamples: [
      "近くに買い物できる店が少ない",
      "ごみ出しのルールや収集日が分かりにくい",
      "道路や歩道の傷みが気になる",
      "街灯が少なく夜道が不安",
    ],
    improvementExamples: [
      "買い物支援の仕組みを充実させてほしい",
      "道路・歩道の整備を進めてほしい",
    ],
    wantedInfo: "日常の買い物や暮らしの中で不便に感じていること、生活環境について改善してほしい点などをお寄せください。",
  },
  {
    slug: "work-local-economy",
    title: "仕事、地域経済",
    category: "仕事、地域経済",
    status: "募集中",
    period: "",
    description: "仕事・地域経済に関するお困りごとやご意見を募集します。",
    examples: "雇用、事業者支援、商店街、地域産業など",
    troubleExamples: [
      "地元で希望する仕事が見つかりにくい",
      "商店街や個人事業者の後継者が少ない",
      "若い世代が就職を機に市外へ出てしまう",
      "副業や在宅ワークの情報が少ない",
    ],
    improvementExamples: [
      "地元企業や商店街への支援を充実させてほしい",
      "若者が地元で働き続けられる環境をつくってほしい",
    ],
    wantedInfo: "仕事探しで感じた課題、事業を営む中でのご苦労、延岡の産業・雇用に関するご意見などをお寄せください。",
  },
  {
    slug: "administrative-procedures",
    title: "行政手続き",
    category: "行政手続き",
    status: "募集中",
    period: "",
    description: "行政手続きに関するお困りごとやご意見を募集します。",
    examples: "市役所での手続き、窓口、オンライン化など",
    troubleExamples: [
      "市役所の窓口がどこにあるか分かりにくい",
      "手続きに必要な書類が多く負担に感じる",
      "平日の日中しか手続きできず行きづらい",
      "オンラインで手続きできるものが少ない",
    ],
    improvementExamples: [
      "手続きのオンライン化をさらに進めてほしい",
      "窓口の案内をもっと分かりやすくしてほしい",
    ],
    wantedInfo: "市役所での手続きで感じた分かりにくさ、時間がかかった経験、オンライン化してほしい手続きなどをお寄せください。",
  },
  {
    slug: "local-community",
    title: "地域コミュニティ",
    category: "地域コミュニティ",
    status: "募集中",
    period: "",
    description: "地域コミュニティに関するお困りごとやご意見を募集します。",
    examples: "自治会、地域活動、交流の場など",
    troubleExamples: [
      "自治会の担い手が減っている",
      "地域の行事に参加する機会が少ない",
      "新しく住み始めた人が地域とつながりにくい",
      "世代を超えた交流の場が少ない",
    ],
    improvementExamples: [
      "自治会活動の負担を軽くする仕組みをつくってほしい",
      "誰でも参加しやすい地域の交流の場を増やしてほしい",
    ],
    wantedInfo: "地域活動や自治会で感じている課題、参加してみたい活動、地域のつながりについてのご意見などをお寄せください。",
  },
  {
    slug: "future-of-nobeoka",
    title: "延岡の将来",
    category: "延岡の将来",
    status: "募集中",
    period: "",
    description: "延岡の将来に関するご意見・アイデアを募集します。",
    examples: "まちづくり、人口減少、若者定着、将来像など",
    troubleExamples: [
      "人口減少や若者の流出が心配",
      "延岡の魅力が市外にあまり伝わっていない気がする",
      "将来のまちづくりの方針が分かりにくい",
      "子や孫の世代が住み続けたいと思えるか不安",
    ],
    improvementExamples: [
      "延岡の強みを生かしたまちづくりを進めてほしい",
      "若い世代の声をまちづくりに反映してほしい",
    ],
    wantedInfo: "延岡の将来について感じている期待や不安、こんなまちになってほしいというアイデアなどをお寄せください。",
  },
  {
    slug: "other",
    title: "その他",
    category: "その他",
    status: "募集中",
    period: "",
    description: "上記に当てはまらないご意見を募集します。",
    examples: "ほかのテーマに該当しない意見や提案",
    troubleExamples: [
      "上記のどのテーマにも当てはまらない困りごとがある",
      "複数の分野にまたがる意見を伝えたい",
      "テーマが決まる前の段階の気づきを伝えたい",
    ],
    improvementExamples: ["分野を問わず、気づいたことを伝えられる窓口を維持してほしい"],
    wantedInfo: "他のテーマに当てはまらないご意見、複数の分野にまたがるお困りごと、その他お気づきの点などをお寄せください。",
  },
];

export function getVoiceTheme(slug: string): VoiceTheme | undefined {
  return voiceThemes.find((t) => t.slug === slug);
}
