// コンテンツ・データ内で存在しないslugを参照してしまう設定ミスに、ビルド時のコンソール
// 出力で気づけるようにするための軽量チェック。console.warnのみで、本番ビルド自体を
// 失敗させることはない（意図的にthrowしない）。
export function warnIfMissingSlug(exists: boolean, context: string, slug: string) {
  if (!exists && slug) {
    console.warn(`[content-check] ${context}: 存在しないslug "${slug}" が指定されています。`);
  }
}
