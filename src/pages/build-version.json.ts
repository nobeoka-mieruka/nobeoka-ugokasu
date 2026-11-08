// /build-version.json（ビルド時に生成する静的ファイル）
// 公開中のサイトが、どのコミットからビルドされたかを示します。
// 新しいページの公開検知（.github/workflows/detect-new-pages.yml）が、デプロイの完了を確かめるために使います。
// 中身はコミットのID（ハッシュ）とビルド日時だけです（執行部ポータルの「サイトの状態」にも表示します）。
import type { APIRoute } from "astro";
import buildInfo from "../data/build-info.json";

export const GET: APIRoute = () =>
  new Response(JSON.stringify({ commitSha: buildInfo.commitSha ?? null, builtAt: buildInfo.generatedAt ?? null }), {
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
