// 私たちの提言（8-5章・10章準拠）
// 予算額・開始時期・財源・達成率など確認できていない情報は含めていません。
// 最終更新日は本人確認後に設定する（未設定の間はLastUpdatedコンポーネント側で自動的に非表示になる）。

export type VisionProposal = {
  slug: "welfare" | "childcare" | "disaster-prevention";
  title: string;
  shortTitle: string;
  accentColor: "welfare" | "childcare" | "disaster";
  background: string[];
  currentIssues: string[];
  /** 主にどなたに関わる提言か（背景・現状の課題から自然に読み取れる範囲のみ記載） */
  targetAudience: string;
  proposals: string[];
  /** 行政に求めること。個別に確定していない場合は自然な案内文を設定する */
  administrativeAsk: string;
  targetChange: string;
  citizenVoices: string;
  reviewStatus: string;
  /** 関連する公的資料・延岡市公式ページ（確認できたものだけを追加する） */
  officialLinks: { label: string; href: string }[];
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
    accentColor: "welfare",
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
    targetChange:
      "支える人も、支えられる人も、安心して暮らせる延岡を目指します。",
    citizenVoices:
      "「みんなの声」を通じて、福祉・介護に関するご意見を募集しています。寄せられた声はこのページへ順次反映していきます。",
    reviewStatus: "現在検討中です。皆さまのご意見を伺いながら具体化します。",
    officialLinks: [],
    lastUpdated: "",
  },
  {
    slug: "childcare",
    title: "安心して\n子育てできるまち",
    shortTitle: "子育てについて",
    accentColor: "childcare",
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
    targetChange: "安心して子育てできる延岡を目指します。",
    citizenVoices:
      "「みんなの声」を通じて、子育てに関するご意見を募集しています。寄せられた声はこのページへ順次反映していきます。",
    reviewStatus: "現在検討中です。皆さまのご意見を伺いながら具体化します。",
    officialLinks: [],
    lastUpdated: "",
  },
  {
    slug: "disaster-prevention",
    title: "災害時に\n命を守れるまち",
    shortTitle: "防災・避難について",
    accentColor: "disaster",
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
    targetChange: "災害時に命を守れる延岡を目指します。",
    citizenVoices:
      "「みんなの声」を通じて、防災・避難に関するご意見を募集しています。寄せられた声はこのページへ順次反映していきます。",
    reviewStatus: "現在検討中です。皆さまのご意見を伺いながら具体化します。",
    officialLinks: [],
    lastUpdated: "",
  },
];

export function getVisionProposal(slug: string): VisionProposal | undefined {
  return visionProposals.find((p) => p.slug === slug);
}
