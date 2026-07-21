// 「延岡市役所 どこに行けばいい？診断」のデータです。
// 延岡市公式ホームページ「組織でさがす」（https://www.city.nobeoka.miyazaki.jp/soshiki/）
// に掲載されている各課ページを基準に、部署名・電話番号・公式ページURLを整理しています。
//
// 【将来、質問や担当課を追加・修正する方法】
// - 担当課を増やす／内容を直す場合は departments に1件追加・編集してください。
// - 質問を増やす場合は、該当カテゴリの questions 配列に追加し、
//   前の設問の yes/no の行き先（id）を書き換えてください。
// - 行き先は「次の設問のid」か「dept:担当課id」のどちらかで指定します。
// - 質問が0件のカテゴリ（「わからない」など）は、firstQuestionId を null にすると
//   すぐに resultDeptId の結果を表示します。
// - 各課の電話番号・受付時間・掲載内容は組織改編等で変わる場合があるため、
//   lastConfirmedAt（最終確認日）を更新した上で内容を見直してください。
//
// 【将来ライフイベント別（結婚・出生・引っ越し・死亡）に拡張する場合】
// 同じ形（IconName・questions・departments）のまま、新しいカテゴリを
// cityGuideCategories に追加するだけで拡張できる構造にしています。

import type { IconName } from "../types/icon";

export interface CityDepartment {
  id: string;
  name: string;
  summary: string;
  /**
   * この課の直通電話番号（例："0982-xx-xxxx"）。確認できるまでは未設定のままにしてください
   * （未設定の間は、確認できていれば代表電話番号を、それも無ければ「確認中」を表示します）。
   */
  phone?: string;
  /**
   * 受付時間が全課共通（src/config/cityGuideConfig.tsのofficeHours）と異なる場合のみ設定する
   * 個別の受付時間（例：「月曜〜日曜 9:00〜16:00」）。通常は未設定のままにしてください。
   */
  hours?: string;
  /** 市役所本庁舎内の窓口場所（例："本庁舎1階"）。確認できる場合のみ設定してください */
  location?: string;
  /** 公式ページURL（未設定の間はボタンを表示しません） */
  officialUrl?: string;
  /** この案内内容を最終確認した日（"YYYY-MM-DD"）。未設定の間は表示しません */
  lastConfirmedAt?: string;
}

export interface CityGuideQuestion {
  id: string;
  text: string;
  /** 遷移先：次の設問id、または "dept:担当課id" */
  yes: string;
  no: string;
}

export interface CityGuideCategory {
  id: string;
  label: string;
  icon: IconName;
  /** 質問が1つもない場合はnull（例：「わからない」） */
  firstQuestionId: string | null;
  questions: CityGuideQuestion[];
  /** firstQuestionIdがnullの場合に直接表示する担当課id */
  resultDeptId?: string;
}

export const generalGuidanceDeptId = "sogo";

// 電話番号・URLは https://www.city.nobeoka.miyazaki.jp/soshiki/ 配下の各課ページ（2026年7月22日確認）に基づく。
// 1課に複数の係がある場合は、市民からの相談内容に最も近い係の番号を掲載している
// （例：市民税課は普通徴収を扱う市民税第1係、介護保険課は要介護認定を扱う認定係）。
const CONFIRMED_DATE = "2026-07-22";

export const cityDepartments: CityDepartment[] = [
  {
    id: "shimin",
    name: "市民課",
    summary: "転入・転出・転居、住民票、戸籍、印鑑登録・印鑑証明、マイナンバーカードなど",
    phone: "0982-22-7015",
    officialUrl: "https://www.city.nobeoka.miyazaki.jp/soshiki/23/",
    lastConfirmedAt: CONFIRMED_DATE,
  },
  {
    id: "shimin-zei",
    name: "市民税課",
    summary: "市県民税、軽自動車税など",
    phone: "0982-22-7012",
    officialUrl: "https://www.city.nobeoka.miyazaki.jp/soshiki/19/",
    lastConfirmedAt: CONFIRMED_DATE,
  },
  {
    id: "shisan-zei",
    name: "資産税課",
    summary: "固定資産税（土地・家屋）など",
    phone: "0982-22-7043",
    officialUrl: "https://www.city.nobeoka.miyazaki.jp/soshiki/20/",
    lastConfirmedAt: CONFIRMED_DATE,
  },
  {
    id: "nouzei",
    name: "納税課",
    summary: "税金の納付、納税相談など",
    phone: "0982-22-7011",
    officialUrl: "https://www.city.nobeoka.miyazaki.jp/soshiki/21/",
    lastConfirmedAt: CONFIRMED_DATE,
  },
  {
    id: "kodomo-hoiku",
    name: "こども保育課",
    summary: "保育園・認定こども園・入園の相談など",
    phone: "0982-22-7017",
    officialUrl: "https://www.city.nobeoka.miyazaki.jp/soshiki/30/",
    lastConfirmedAt: CONFIRMED_DATE,
  },
  {
    id: "oyako-hoken",
    name: "おやこ保健福祉課",
    summary: "妊娠・出産、乳幼児健診、子育て相談など",
    phone: "0982-20-7174",
    officialUrl: "https://www.city.nobeoka.miyazaki.jp/soshiki/32/",
    lastConfirmedAt: CONFIRMED_DATE,
  },
  {
    id: "kodomo-katei",
    name: "こども家庭サポートセンター",
    summary: "子どもや家庭の悩み、虐待、家庭相談など",
    phone: "0982-20-7250",
    officialUrl: "https://www.city.nobeoka.miyazaki.jp/soshiki/92/",
    lastConfirmedAt: CONFIRMED_DATE,
  },
  {
    id: "kyoiku",
    name: "学校教育課",
    summary: "小中学校に関する相談など",
    phone: "0982-22-7031",
    officialUrl: "https://www.city.nobeoka.miyazaki.jp/soshiki/59/",
    lastConfirmedAt: CONFIRMED_DATE,
  },
  {
    id: "kaigo-hoken",
    name: "介護保険課",
    summary: "介護保険、要介護認定など",
    phone: "0982-22-7071",
    officialUrl: "https://www.city.nobeoka.miyazaki.jp/soshiki/28/",
    lastConfirmedAt: CONFIRMED_DATE,
  },
  {
    id: "kenko-choju",
    name: "健康長寿課",
    summary: "高齢者の見守り、介護予防、認知症などの相談",
    phone: "0982-22-7072",
    officialUrl: "https://www.city.nobeoka.miyazaki.jp/soshiki/33/",
    lastConfirmedAt: CONFIRMED_DATE,
  },
  {
    id: "shogai-fukushi",
    name: "障がい福祉課",
    summary: "障がい者手帳、障がい福祉サービスの相談など",
    phone: "0982-22-7059",
    officialUrl: "https://www.city.nobeoka.miyazaki.jp/soshiki/31/",
    lastConfirmedAt: CONFIRMED_DATE,
  },
  {
    id: "seikatsu-fukushi",
    name: "生活福祉課",
    summary: "生活費、生活保護、生活の困りごとの相談など",
    phone: "0982-22-7041",
    officialUrl: "https://www.city.nobeoka.miyazaki.jp/soshiki/29/",
    lastConfirmedAt: CONFIRMED_DATE,
  },
  {
    id: "shigen-taisaku",
    name: "資源対策課",
    summary: "ごみの分別・収集など",
    phone: "0982-34-2626",
    officialUrl: "https://www.city.nobeoka.miyazaki.jp/soshiki/25/",
    lastConfirmedAt: CONFIRMED_DATE,
  },
  {
    id: "seikatsu-kankyo",
    name: "生活環境課",
    summary: "生活環境、騒音、犬猫などの相談",
    phone: "0982-22-7001",
    officialUrl: "https://www.city.nobeoka.miyazaki.jp/soshiki/24/",
    lastConfirmedAt: CONFIRMED_DATE,
  },
  {
    id: "kenchiku-jutaku",
    name: "建築住宅課",
    summary: "市営住宅、住宅の相談など",
    phone: "0982-22-7023",
    officialUrl: "https://www.city.nobeoka.miyazaki.jp/soshiki/50/",
    lastConfirmedAt: CONFIRMED_DATE,
  },
  {
    id: "akiya",
    name: "空家施策推進室",
    summary: "空き家に関する相談",
    phone: "0982-20-7170",
    officialUrl: "https://www.city.nobeoka.miyazaki.jp/soshiki/98/",
    lastConfirmedAt: CONFIRMED_DATE,
  },
  {
    id: "doboku",
    name: "土木課",
    summary: "道路、側溝、河川などの相談",
    phone: "0982-22-7021",
    officialUrl: "https://www.city.nobeoka.miyazaki.jp/soshiki/48/",
    lastConfirmedAt: CONFIRMED_DATE,
  },
  {
    id: "suido",
    name: "上下水道局 業務課",
    summary: "水道・下水道についての相談",
    phone: "0982-21-6486",
    officialUrl: "https://www.city.nobeoka.miyazaki.jp/soshiki/55/",
    lastConfirmedAt: CONFIRMED_DATE,
  },
  {
    id: "shoko",
    name: "産業政策課",
    summary: "仕事、雇用、企業支援、商工業の相談",
    phone: "0982-22-7350",
    officialUrl: "https://www.city.nobeoka.miyazaki.jp/soshiki/40/",
    lastConfirmedAt: CONFIRMED_DATE,
  },
  {
    id: "norinsuisan",
    name: "総合農政課",
    summary: "農業、林業、水産業の相談",
    phone: "0982-22-7073",
    officialUrl: "https://www.city.nobeoka.miyazaki.jp/soshiki/36/",
    lastConfirmedAt: CONFIRMED_DATE,
  },
  {
    id: "bousai",
    name: "危機管理企画課",
    summary: "災害、防災、避難などの相談",
    phone: "0982-22-7077",
    officialUrl: "https://www.city.nobeoka.miyazaki.jp/soshiki/15/",
    lastConfirmedAt: CONFIRMED_DATE,
  },
  {
    id: generalGuidanceDeptId,
    name: "なんでも総合相談センター",
    summary: "内容がはっきりしない場合は、まずはこちらにご相談ください。日常生活の困りごとを幅広く受け付ける総合相談窓口です。",
    phone: "0982-20-7105",
    // 通常の窓口受付時間（平日）とは異なり、土日を含め受け付けているため個別に設定
    hours: "月曜〜日曜 9:00〜16:00",
    officialUrl: "https://www.city.nobeoka.miyazaki.jp/soshiki/34/",
    lastConfirmedAt: CONFIRMED_DATE,
  },
];

export const cityGuideCategories: CityGuideCategory[] = [
  {
    id: "address",
    label: "住所・戸籍・証明書",
    icon: "document",
    firstQuestionId: "address-q1",
    questions: [
      { id: "address-q1", text: "住所変更や住民票の手続きですか？", yes: "dept:shimin", no: "address-q2" },
      { id: "address-q2", text: "戸籍・印鑑証明・マイナンバーカードの手続きですか？", yes: "dept:shimin", no: `dept:${generalGuidanceDeptId}` },
    ],
  },
  {
    id: "tax",
    label: "税金・保険料",
    icon: "coin",
    firstQuestionId: "tax-q1",
    questions: [
      { id: "tax-q1", text: "市県民税・軽自動車税についてですか？", yes: "dept:shimin-zei", no: "tax-q2" },
      { id: "tax-q2", text: "固定資産税（土地・家屋）についてですか？", yes: "dept:shisan-zei", no: "tax-q3" },
      { id: "tax-q3", text: "税金の納付や納税相談ですか？", yes: "dept:nouzei", no: `dept:${generalGuidanceDeptId}` },
    ],
  },
  {
    id: "childcare",
    label: "子育て・学校",
    icon: "childcare",
    firstQuestionId: "childcare-q1",
    questions: [
      { id: "childcare-q1", text: "保育園・認定こども園・入園の相談ですか？", yes: "dept:kodomo-hoiku", no: "childcare-q2" },
      { id: "childcare-q2", text: "妊娠・出産・乳幼児健診・子育て相談ですか？", yes: "dept:oyako-hoken", no: "childcare-q3" },
      { id: "childcare-q3", text: "子どもや家庭の悩み、虐待、家庭相談ですか？", yes: "dept:kodomo-katei", no: "childcare-q4" },
      { id: "childcare-q4", text: "小中学校に関する相談ですか？", yes: "dept:kyoiku", no: `dept:${generalGuidanceDeptId}` },
    ],
  },
  {
    id: "elderly",
    label: "高齢者・介護",
    icon: "welfare",
    firstQuestionId: "elderly-q1",
    questions: [
      { id: "elderly-q1", text: "介護保険や要介護認定のことですか？", yes: "dept:kaigo-hoken", no: "elderly-q2" },
      { id: "elderly-q2", text: "高齢者の見守り、介護予防、認知症などの相談ですか？", yes: "dept:kenko-choju", no: `dept:${generalGuidanceDeptId}` },
    ],
  },
  {
    id: "disability-life",
    label: "障がい・生活の相談",
    icon: "handshake",
    firstQuestionId: "disability-life-q1",
    questions: [
      { id: "disability-life-q1", text: "障がい者手帳や障がい福祉サービスの相談ですか？", yes: "dept:shogai-fukushi", no: "disability-life-q2" },
      { id: "disability-life-q2", text: "生活費、生活保護、生活の困りごとの相談ですか？", yes: "dept:seikatsu-fukushi", no: `dept:${generalGuidanceDeptId}` },
    ],
  },
  {
    id: "waste-env",
    label: "ごみ・環境",
    icon: "trash",
    firstQuestionId: "waste-env-q1",
    questions: [
      { id: "waste-env-q1", text: "ごみの分別や収集についてですか？", yes: "dept:shigen-taisaku", no: "waste-env-q2" },
      { id: "waste-env-q2", text: "生活環境、騒音、犬猫などの相談ですか？", yes: "dept:seikatsu-kankyo", no: `dept:${generalGuidanceDeptId}` },
    ],
  },
  {
    id: "housing-road",
    label: "住宅・空き家・道路",
    icon: "house",
    firstQuestionId: "housing-road-q1",
    questions: [
      { id: "housing-road-q1", text: "市営住宅や住宅の相談ですか？", yes: "dept:kenchiku-jutaku", no: "housing-road-q2" },
      { id: "housing-road-q2", text: "空き家に関する相談ですか？", yes: "dept:akiya", no: "housing-road-q3" },
      { id: "housing-road-q3", text: "道路、側溝、河川などの相談ですか？", yes: "dept:doboku", no: `dept:${generalGuidanceDeptId}` },
    ],
  },
  {
    id: "water",
    label: "水道・下水道",
    icon: "water-drop",
    firstQuestionId: "water-q1",
    questions: [
      { id: "water-q1", text: "水道や下水道についての相談ですか？", yes: "dept:suido", no: `dept:${generalGuidanceDeptId}` },
    ],
  },
  {
    id: "work",
    label: "仕事・事業・農業",
    icon: "briefcase",
    firstQuestionId: "work-q1",
    questions: [
      { id: "work-q1", text: "仕事、雇用、企業支援、商工業の相談ですか？", yes: "dept:shoko", no: "work-q2" },
      { id: "work-q2", text: "農業、林業、水産業の相談ですか？", yes: "dept:norinsuisan", no: `dept:${generalGuidanceDeptId}` },
    ],
  },
  {
    id: "disaster",
    label: "防災・災害",
    icon: "disaster",
    firstQuestionId: "disaster-q1",
    questions: [
      { id: "disaster-q1", text: "災害、防災、避難などの相談ですか？", yes: "dept:bousai", no: `dept:${generalGuidanceDeptId}` },
    ],
  },
  {
    id: "unknown",
    label: "どれに当てはまるか分からない",
    icon: "ellipsis",
    firstQuestionId: null,
    questions: [],
    resultDeptId: generalGuidanceDeptId,
  },
];

export function getDepartment(id: string): CityDepartment | undefined {
  return cityDepartments.find((d) => d.id === id);
}
