// 私たちの提言（8-5章・10章準拠）
// 予算額・開始時期・財源・達成率など確認できていない情報は含めていません。
// 最終更新日は本人確認後に設定する（未設定の間はLastUpdatedコンポーネント側で自動的に非表示になる）。

/**
 * 提言の検討状況ステータス。実施が決まっていない段階のため「実施決定」「実現予定」等は
 * 使わず、現在の取り組み段階（声を集めている／調べている等）だけを示す。
 */
export type VisionStatus =
  | "意見募集中"
  | "現状調査中"
  | "制度調査中"
  | "提言案作成中"
  | "内容整理中"
  | "提言公開";

/**
 * ステータス表示（VisionStatusSteps）用の進行順。
 * VisionStatus型の宣言順とは独立して、UI上の見せ方だけをここで定義する
 * （文言そのものは変更しない）。
 */
export const VISION_STATUS_ORDER: VisionStatus[] = [
  "意見募集中",
  "現状調査中",
  "制度調査中",
  "内容整理中",
  "提言案作成中",
  "提言公開",
];

/** 現状データ・参考資料カードの1項目（数値は事実確認できたものだけを登録すること。推測禁止） */
export type VisionEvidenceItem = {
  /** 何のデータか（例："延岡市の高齢化率"） */
  label: string;
  /** 数値・内容（例："38.2%（2025年時点）"） */
  value: string;
  /** 出典（例：延岡市「高齢者福祉計画」） */
  source: string;
  /** 出典URL（確認できる場合のみ） */
  sourceUrl?: string;
  /** データを確認した日（"YYYY-MM-DD"） */
  confirmedDate: string;
};

export type VisionProposal = {
  slug: "welfare" | "childcare" | "disaster-prevention";
  title: string;
  shortTitle: string;
  /**
   * 提言の概要（1〜2文）。一覧・カードの冒頭で「何についての提言か」を一言で伝える。
   * 確認できている内容だけを書くこと（数値・実績の断定は禁止）。
   */
  summary: string;
  accentColor: "welfare" | "childcare" | "disaster";
  /** 現在の検討状況（バッジ表示用）。根拠のない前倒しの状態にしない。 */
  status: VisionStatus;
  /** 関連する活動報告を見つけるためのキーワード（投稿タイトル・本文に部分一致するかで判定） */
  relatedKeywords: string[];
  /** 「みんなの声」でこの提言に対応するテーマのslug（src/data/voiceThemes.ts参照） */
  relatedVoiceThemeSlug: string;
  background: string[];
  currentIssues: string[];
  /** 主にどなたに関わる提言か（背景・現状の課題から自然に読み取れる範囲のみ記載） */
  targetAudience: string;
  proposals: string[];
  /** 行政に求めること。個別に確定していない場合は自然な案内文を設定する */
  administrativeAsk: string;
  /** 実現へのステップ（短期・中期・長期）。個別に確定していない場合は自然な案内文を設定する */
  implementationSteps: {
    shortTerm: string;
    midTerm: string;
    longTerm: string;
  };
  targetChange: string;
  citizenVoices: string;
  reviewStatus: string;
  /**
   * 現在の調査状況。どこまで調べ終えていて、次に何を確認するのかを書く。
   * 事実として確認できている範囲だけを書くこと（進捗を実際より進んで見せない）。
   */
  investigationStatus: string;
  /**
   * 関連する公的資料・延岡市公式ページ（確認できたものだけを追加する）。
   * URLは必ず実際にアクセスして存在を確認してから追加すること（架空リンクは禁止）。
   * confirmedDate には、そのURLを確認した日（"YYYY-MM-DD"）を記録する。
   */
  officialLinks: { label: string; href: string; confirmedDate?: string }[];
  /**
   * 現状データ・参考資料カードに表示する統計・データ。
   * 事実確認できたものだけを登録すること（推測での入力は禁止）。
   * 未登録の間はVisionEvidenceCard側で「公的資料を確認しながら整理しています」と表示される。
   */
  evidenceItems: VisionEvidenceItem[];
  /** 関連する延岡市・宮崎県・国の計画や制度（確認できたものだけを追加する） */
  relatedPlans: { label: string; href?: string }[];
  /** この提言の背景となる、福富千恵プロフィールページの章id（src/data/profile.ts参照）。自然に対応する章がない場合は空配列のままにする */
  relatedProfileChapterIds: string[];
  /** 最終更新日（本人確認後に設定。未設定の間はLastUpdated側で非表示になる） */
  lastUpdated: string;
};

export const visionHeading = "私の提言";
export const visionSubtitle = "つながり、支え合い、\n希望あふれる延岡へ。";

export const visionProposals: VisionProposal[] = [
  {
    slug: "welfare",
    title: "支える人も\n支えられる人も\n安心できるまち",
    shortTitle: "福祉・介護について",
    summary:
      "介護や障がい福祉の現場で働いてきた経験をもとに、支える家族の負担軽減と、福祉を担う人材の確保・定着に取り組みます。",
    accentColor: "welfare",
    status: "意見募集中",
    relatedKeywords: ["福祉", "障がい福祉", "介護", "高齢者", "就労支援", "とまりぎ荘"],
    relatedVoiceThemeSlug: "welfare-care",
    background: [
      "福富千恵は障がい福祉事業所の運営や特定非営利活動法人 とまりぎ荘 理事長としての活動を通じて、介護する家族の負担の大きさを日々感じてきました。",
      "生きている限り、サポートを必要とするのはお互い様です。支え合いが当たり前になる延岡を目指しています。",
    ],
    currentIssues: [
      "支える家族側への支援が十分に届いていないと感じる場面があります。",
      "福祉の現場を支える人材の確保・育成が課題になっています。",
    ],
    targetAudience: "介護など、家族や身近な人を支えている方、福祉的な支援を必要としている方",
    proposals: [
      "高齢者見守り・\n同行支援登録制度の推進",
      "福祉現場の事務負担を減らす\nICT導入支援",
      "福祉職員の採用・研修・\n定着の支援",
    ],
    administrativeAsk: "現在、現場の声や既存制度を確認しながら、具体的な内容を整理しています。",
    implementationSteps: {
      shortTerm: "「みんなの声」を通じて、福祉・介護の現場の声や困りごとを幅広く集めています。",
      midTerm: "現在、現場の声や既存制度を確認しながら、具体的な内容を整理しています。",
      longTerm: "現在、現場の声や既存制度を確認しながら、具体的な内容を整理しています。",
    },
    targetChange:
      "支える人も、支えられる人も、安心して暮らせる延岡を目指します。",
    citizenVoices:
      "「みんなの声」を通じて、福祉・介護に関するご意見を募集しています。寄せられた声はこのページへ順次反映していきます。",
    reviewStatus: "現在検討中です。皆さまのご意見を伺いながら具体化します。",
    investigationStatus:
      "延岡市で福祉・介護に関する相談を受け付けている窓口（介護保険課・障がい福祉課・健康長寿課・生活福祉課）を確認し、下の参考資料に整理しました。今後、各窓口が公開している制度や計画の内容を確認しながら、提言の具体化を進めます。市の統計や計画に基づく数値は、出典を確認できたものから順にこのページへ掲載します。",
    officialLinks: [
      {
        label: "延岡市 介護保険課",
        href: "https://www.city.nobeoka.miyazaki.jp/soshiki/28/",
        confirmedDate: "2026-09-07",
      },
      {
        label: "延岡市 障がい福祉課",
        href: "https://www.city.nobeoka.miyazaki.jp/soshiki/31/",
        confirmedDate: "2026-09-07",
      },
      {
        label: "延岡市 健康長寿課",
        href: "https://www.city.nobeoka.miyazaki.jp/soshiki/33/",
        confirmedDate: "2026-09-07",
      },
      {
        label: "延岡市 生活福祉課",
        href: "https://www.city.nobeoka.miyazaki.jp/soshiki/29/",
        confirmedDate: "2026-09-07",
      },
    ],
    evidenceItems: [],
    relatedPlans: [],
    relatedProfileChapterIds: [
      "encounter-with-disability-welfare",
      "operating-welfare-office",
      "family-caregiving-burden",
      "need-for-mutual-support",
      "difficulty-seeking-support",
    ],
    lastUpdated: "",
  },
  {
    slug: "childcare",
    title: "安心して\n子育てできるまち",
    shortTitle: "子育てについて",
    summary:
      "保育の現場での勤務と、3人の子どもを育てた経験をもとに、手続きの負担軽減と子育てを支える団体への支援に取り組みます。",
    accentColor: "childcare",
    status: "意見募集中",
    relatedKeywords: ["子ども", "子育て", "教育", "保育", "発達支援"],
    relatedVoiceThemeSlug: "childcare-education",
    background: [
      "福富千恵は保育園・企業内託児所での勤務経験と、3人の子どもを育てたシングルマザーとしての経験を持っています。",
      "制度や手続きの複雑さ、支援を求める難しさを当事者として経験してきました。",
    ],
    currentIssues: [
      "各種手続きが複雑で、必要な人ほど負担を感じやすい状況があります。",
      "子育てを支える団体への支援が十分でないと感じる場面があります。",
    ],
    targetAudience: "延岡市内で子育てをしている方、子育てを支える活動に取り組む団体",
    proposals: [
      "スマートフォンでの\n行政手続きを推進",
      "子どもサポート団体への支援事業",
    ],
    administrativeAsk: "現在、現場の声や既存制度を確認しながら、具体的な内容を整理しています。",
    implementationSteps: {
      shortTerm: "「みんなの声」を通じて、子育て世帯の声や困りごとを幅広く集めています。",
      midTerm: "現在、現場の声や既存制度を確認しながら、具体的な内容を整理しています。",
      longTerm: "現在、現場の声や既存制度を確認しながら、具体的な内容を整理しています。",
    },
    targetChange: "安心して子育てできる延岡を目指します。",
    citizenVoices:
      "「みんなの声」を通じて、子育てに関するご意見を募集しています。寄せられた声はこのページへ順次反映していきます。",
    reviewStatus: "現在検討中です。皆さまのご意見を伺いながら具体化します。",
    investigationStatus:
      "延岡市で子育てに関する相談を受け付けている窓口（こども保育課・おやこ保健福祉課・こども家庭サポートセンター）を確認し、下の参考資料に整理しました。今後、各窓口が公開している制度や手続きの内容を確認しながら、提言の具体化を進めます。",
    officialLinks: [
      {
        label: "延岡市 こども保育課",
        href: "https://www.city.nobeoka.miyazaki.jp/soshiki/30/",
        confirmedDate: "2026-09-07",
      },
      {
        label: "延岡市 おやこ保健福祉課",
        href: "https://www.city.nobeoka.miyazaki.jp/soshiki/32/",
        confirmedDate: "2026-09-07",
      },
    ],
    evidenceItems: [],
    relatedPlans: [],
    relatedProfileChapterIds: [
      "complex-procedures",
      "childcare-work",
      "marriage-and-childcare",
      "raising-three-children",
      "child-illness",
    ],
    lastUpdated: "",
  },
  {
    slug: "disaster-prevention",
    title: "災害時に\n命を守れるまち",
    shortTitle: "防災・避難について",
    summary:
      "災害時に配慮が必要な方の避難と、避難所での医療・福祉面の備えについて、地域の声を聞きながら取り組みます。",
    accentColor: "disaster",
    status: "意見募集中",
    relatedKeywords: ["防災", "避難", "災害", "地域防災"],
    relatedVoiceThemeSlug: "disaster-prevention",
    background: [
      "延岡は自然災害への備えが暮らしの安心に直結する地域です。",
      "福祉の現場に携わってきた立場から、災害時に配慮が必要な方々への備えの重要性を感じています。",
    ],
    currentIssues: [
      "災害時に連絡が取れなくなる不安があります。",
      "医療面・福祉面に配慮した避難所づくりが十分でないと感じる場面があります。",
    ],
    targetAudience: "災害時に特に配慮が必要な方やそのご家族、地域の防災に関わる方",
    proposals: [
      "個別避難計画の早期作成",
      "災害時でもつながる\nネットワーク構築",
      "避難所機能強化\n（医療・福祉面）",
    ],
    administrativeAsk: "現在、現場の声や既存制度を確認しながら、具体的な内容を整理しています。",
    implementationSteps: {
      shortTerm: "「みんなの声」を通じて、防災・避難に関する不安や困りごとを幅広く集めています。",
      midTerm: "現在、現場の声や既存制度を確認しながら、具体的な内容を整理しています。",
      longTerm: "現在、現場の声や既存制度を確認しながら、具体的な内容を整理しています。",
    },
    targetChange: "災害時に命を守れる延岡を目指します。",
    citizenVoices:
      "「みんなの声」を通じて、防災・避難に関するご意見を募集しています。寄せられた声はこのページへ順次反映していきます。",
    reviewStatus: "現在検討中です。皆さまのご意見を伺いながら具体化します。",
    investigationStatus:
      "延岡市で防災を担当している窓口（危機管理企画課）を確認し、下の参考資料に整理しました。今後、市が公開している避難に関する制度や計画の内容を確認しながら、提言の具体化を進めます。",
    officialLinks: [
      {
        label: "延岡市 危機管理企画課",
        href: "https://www.city.nobeoka.miyazaki.jp/soshiki/15/",
        confirmedDate: "2026-09-07",
      },
    ],
    evidenceItems: [],
    relatedPlans: [],
    relatedProfileChapterIds: [],
    lastUpdated: "",
  },
];

export function getVisionProposal(slug: string): VisionProposal | undefined {
  return visionProposals.find((p) => p.slug === slug);
}
