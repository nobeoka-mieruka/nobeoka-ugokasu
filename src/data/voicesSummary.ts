// 「みんなの声」の受付・整理状況を表示するための集計データです。
//
// 【集計結果を反映する方法】
// 事務局で件数を集計できるようになったら、下記の voicesSummary の値を
// 実際の数値に置き換えてください。数値を入力していない項目（total が
// undefined、categories/status が空配列）は、自動的に「現在集計中です」
// などの自然な案内表示に切り替わります。架空の数値を入力しないでください。

export interface VoicesCategoryCount {
  label: string;
  count: number;
}

export interface VoicesStatusCount {
  label: string;
  count: number;
}

export interface VoicesSummary {
  /** 受付総数。未集計の間はundefinedのままにしてください */
  total?: number;
  /** 分類別件数（例：福祉、子育て、高齢者、行政手続き、地域交通、防災、その他） */
  categories: VoicesCategoryCount[];
  /** 対応状況別件数（例：受付済み、確認中、調査中、提言へ反映、対応状況公開） */
  status: VoicesStatusCount[];
  /** この集計の最終更新日（"YYYY-MM-DD"）。未設定の間は表示しません */
  updatedAt?: string;
}

export const voicesSummary: VoicesSummary = {
  total: undefined,
  categories: [],
  status: [],
  updatedAt: undefined,
};
