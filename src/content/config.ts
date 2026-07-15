import { defineCollection, z } from "astro:content";

// 活動報告（11章準拠）
const activities = defineCollection({
  type: "content",
  schema: z.object({
    title: z.string(),
    date: z.date(),
    updatedDate: z.date().optional(),
    category: z.string(),
    summary: z.string(),
    mainImage: z
      .object({
        src: z.string(),
        alt: z.string(),
      })
      .optional(),
    images: z
      .array(
        z.object({
          src: z.string(),
          alt: z.string(),
        }),
      )
      .default([]),
    location: z.string().optional(),
    author: z.string().default("福富千恵と延岡を動かす会 事務局"),
    published: z.boolean().default(false),
    relatedIssues: z.array(z.enum(["welfare", "childcare", "disaster-prevention"])).default([]),
    relatedVoiceTheme: z.string().optional(),
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
