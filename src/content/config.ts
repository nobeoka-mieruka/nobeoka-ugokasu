import { defineCollection, z } from "astro:content";

// 活動報告（11章準拠）
// mainImage/imagesは image() ヘルパーを使い、記事(.md)と同じフォルダに置いた画像ファイルを
// 相対パスで参照する（例："./photos/example-main.jpg"）。ビルド時にAVIF/WebPへ自動変換され、
// width/heightも自動取得されるため、レイアウトずれ（CLS）が発生しない。
const activities = defineCollection({
  type: "content",
  schema: ({ image }) =>
    z.object({
      title: z.string(),
      date: z.date(),
      updatedDate: z.date().optional(),
      category: z.string(),
      summary: z.string(),
      mainImage: z
        .object({
          src: image(),
          alt: z.string(),
        })
        .optional(),
      images: z
        .array(
          z.object({
            src: image(),
            alt: z.string(),
          }),
        )
        .default([]),
      location: z.string().optional(),
      author: z.string().default("福富千恵と延岡を動かす会 事務局"),
      published: z.boolean().default(false),
      relatedIssues: z.array(z.enum(["welfare", "childcare", "disaster-prevention"])).default([]),
      relatedVoiceTheme: z.string().optional(),
      /**
       * SNS投稿へのリンク（Facebook・Instagramなど、実在する投稿URLのみ設定）。
       * テンプレートの既定値である空文字列 "" も許容する（.url()は空文字列を拒否するため、
       * 明示的に空文字列を許可しないと未入力のまま公開しようとした際にビルドが失敗してしまう）。
       */
      snsPostUrl: z.union([z.string().url(), z.literal("")]).optional(),
    }),
});

// お知らせ（11章準拠）
const news = defineCollection({
  type: "content",
  schema: z.object({
    title: z.string(),
    date: z.date(),
    updatedDate: z.date().optional(),
    category: z.enum(["お知らせ", "活動予定", "意見交換会", "活動報告", "後援会", "サイト更新"]),
    summary: z.string(),
    published: z.boolean().default(false),
  }),
});

// 課題別ページ本文（提言の背景・詳細を非エンジニアでも更新できるように分離）
const issues = defineCollection({
  type: "content",
  schema: z.object({
    title: z.string(),
    description: z.string(),
    accentColor: z.enum(["welfare", "childcare", "disaster"]),
    /** 十分な独自本文が完成するまでは true のまま（noindex表示になります） */
    draft: z.boolean().default(true),
    updatedDate: z.date().optional(),
  }),
});

// みんなの声：分析結果（12-4章準拠）
const voiceReports = defineCollection({
  type: "content",
  schema: z.object({
    title: z.string(),
    theme: z.string(),
    /** 募集期間（未確定の場合は空欄） */
    period: z.string().default(""),
    responseCount: z.number().optional(),
    collectionMethods: z.array(z.string()).default([]),
    lastUpdated: z.date(),
    mainPoints: z.array(z.string()).default([]),
    commonIssues: z.array(z.string()).default([]),
    differingViews: z.array(z.string()).default([]),
    minorityViews: z.array(z.string()).default([]),
    experiences: z.array(z.string()).default([]),
    ideas: z.array(z.string()).default([]),
    futureInvestigation: z.array(z.string()).default([]),
    reflectionInActivities: z.string().default("現在検討中です。"),
    officialResponse: z.string().default(""),
    analysisMethod: z.string().default(""),
    analysisLimitations: z.string().default(""),
    published: z.boolean().default(false),
  }),
});

export const collections = { activities, news, issues, "voice-reports": voiceReports };
