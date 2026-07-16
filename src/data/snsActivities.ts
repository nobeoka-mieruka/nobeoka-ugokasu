// 活動報告ページに掲載する Facebook・Instagram の投稿を手動管理するファイルです。
// Meta APIやアクセストークンは使用しません。投稿を追加したいときは、下の配列に
// オブジェクトを1件追加するだけで、活動報告ページに自動的に反映されます
//（新しい日付順に並び替えられます）。
//
// 【新しい投稿を追加する手順】
// 1. Facebook／Instagramで対象の投稿を「公開」設定で開き、投稿のURLをコピーする
// 2. 下の配列に、次の項目を入力した1件を追加する
//    - id: 他と重複しない半角英数字（例: "2026-08-01-summer-festival"）
//    - date: 投稿日（"YYYY-MM-DD"形式）
//    - title: 活動報告の見出し
//    - description: 短い説明文
//    - platform: "facebook" または "instagram"
//    - postUrl: 投稿の公開URL
//    - image: サムネイル画像（省略可。省略時はアイコン付きのプレースホルダーを表示）
//    - embedEnabled: 投稿の埋め込み表示ボタンを出す場合は true
// 3. 同じ内容をFacebookとInstagramの両方に投稿した場合は、crossPostPlatform と
//    crossPostUrl にもう一方のURLを設定すると、カードを2枚に分けず1枚にまとめられます。

export type SnsPlatform = "facebook" | "instagram";

export interface SnsActivity {
  /** 他の投稿と重複しない識別子 */
  id: string;
  /** 投稿日（"YYYY-MM-DD"形式） */
  date: string;
  /** 活動報告の見出し */
  title: string;
  /** 短い説明文（カードに表示、長い場合は自動的に省略されます） */
  description: string;
  /** 掲載元 */
  platform: SnsPlatform;
  /** 投稿の公開URL */
  postUrl: string;
  /** サムネイル画像（省略可） */
  image?: {
    src: string;
    alt: string;
  };
  /** 投稿の埋め込み表示を許可するか（falseの場合は「見る」ボタンのみ表示） */
  embedEnabled: boolean;
  /** 同じ内容をもう一方のSNSにも投稿している場合、そのプラットフォーム */
  crossPostPlatform?: SnsPlatform;
  /** crossPostPlatform を設定した場合の、もう一方の投稿URL */
  crossPostUrl?: string;
}

// 投稿URLが未登録のため、初期状態では空にしています。
// 実際の投稿が決まり次第、上記の手順に沿って1件ずつ追加してください。
export const snsActivities: SnsActivity[] = [];

/** 新しい日付順に並び替えたSNS投稿一覧を返す */
export function getSortedSnsActivities(): SnsActivity[] {
  return [...snsActivities].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
}

/** 指定したプラットフォーム（クロス投稿分を含む）に該当する投稿が1件でもあるか判定する */
export function hasSnsActivityFor(platform: SnsPlatform): boolean {
  return snsActivities.some((entry) => entry.platform === platform || entry.crossPostPlatform === platform);
}
