// =============================================================
// 「みんなの声」の受付・整理状況を表示するための集計データです。
//
// 【もっとも大切なルール】
// 実数が確認できていない項目は、必ず undefined（または空配列）のままにしてください。
// 推測値・概算値・「だいたいこのくらい」という数字を入れてはいけません。
// 数値が入っていない項目は、画面側で自動的に
//   「現在、寄せられたご意見を整理しています」
// といった自然な案内表示に切り替わります（架空の数字は表示されません）。
//
// 【集計結果を反映する方法】
// 1. 事務局で件数を集計する
// 2. 下の voicesSummary の該当する値を、実際の数値に置き換える
// 3. updatedAt に集計した日（"YYYY-MM-DD"）を入れる
// 4. npm run build が通ることを確認する
//
// 【categories のラベル例】（src/data/voiceThemes.ts の category と揃えると分かりやすい）
// 福祉、介護 / 障がい福祉 / 子育て、教育 / 高齢者支援 / 防災、避難 /
// 地域交通 / 買い物、生活環境 / 仕事、地域経済 / 行政手続き /
// 地域コミュニティ / 延岡の将来 / その他
// =============================================================

export interface VoicesCategoryCount {
  label: string;
  count: number;
}

export interface VoicesStatusCount {
  label: string;
  count: number;
}

/**
 * 受付から提言反映までの各段階の件数。
 * 「受付 → 整理中 → 確認中 → 提言反映」という流れの表示に使います。
 * 集計できていない段階は undefined のままにしてください。
 */
export interface VoicesPipelineCounts {
  /** 受け付けた件数（累計） */
  received?: number;
  /** 内容を整理し終えた件数 */
  organized?: number;
  /** 事務局で内容を確認している件数 */
  underReview?: number;
  /** 提言へ反映した件数 */
  reflected?: number;
}

export interface VoicesSummary {
  /** 受付総数。未集計の間はundefinedのままにしてください */
  total?: number;
  /** 受付から提言反映までの段階別件数 */
  pipeline: VoicesPipelineCounts;
  /** 分類別件数（例：福祉、子育て、高齢者、行政手続き、地域交通、防災、その他） */
  categories: VoicesCategoryCount[];
  /** 対応状況別件数（src/config/voicesConfig.ts の responseStatusLabels と揃える） */
  status: VoicesStatusCount[];
  /** この集計の最終更新日（"YYYY-MM-DD"）。未設定の間は表示しません */
  updatedAt?: string;
}

export const voicesSummary: VoicesSummary = {
  total: undefined,
  pipeline: {
    received: undefined,
    organized: undefined,
    underReview: undefined,
    reflected: undefined,
  },
  categories: [],
  status: [],
  updatedAt: undefined,
};

/** 集計済みの実数が1つでも入っているか（1つも無い場合は件数表示そのものを出さない） */
export function hasAnyVoicesCount(summary: VoicesSummary = voicesSummary): boolean {
  const pipelineValues = Object.values(summary.pipeline).filter((value) => typeof value === "number");
  return (
    typeof summary.total === "number" ||
    pipelineValues.length > 0 ||
    summary.categories.length > 0 ||
    summary.status.length > 0
  );
}
