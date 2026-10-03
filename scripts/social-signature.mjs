// SNS投稿一覧の「署名」を計算する共通関数です（Node.js用）。
// server/kv.ts の postsSignature() と同じ計算方法で、次の2か所から使います。
//   ・scripts/sync-social-posts.mjs … ビルドした時点の署名を public/social-build-manifest.json へ書き出す
//   ・.github/workflows/refresh-social-posts.yml … 本番APIの最新内容と比べ、変化があるときだけ再ビルドする
// 投稿の追加・削除・本文の編集・画像の差し替えのいずれかで値が変わります。

export function postsSignature(posts) {
  // 並び順に左右されないよう、SNS名・投稿IDの順に並べてから計算する
  const material = [...posts]
    .sort((a, b) => `${a.platform}:${a.id}`.localeCompare(`${b.platform}:${b.id}`))
    .map((p) =>
      [p.platform, p.id, p.publishedAt, p.title, p.description, p.permalink, p.localImage?.src ?? "", p.mediaCount ?? 1].join("\u0001"),
    )
    .join("\u0002");
  let hash = 0x811c9dc5;
  for (let i = 0; i < material.length; i++) {
    hash ^= material.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return `${posts.length}-${(hash >>> 0).toString(16).padStart(8, "0")}`;
}
