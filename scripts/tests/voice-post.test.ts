// 「みんなの声ポスト」（/voice-post/）のテストです。
// フォーム準備前に送信導線が出ないこと、既存フォームを流用しないこと、指定の文言どおりであることを確認します。
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dialogueConfig } from "../../src/config/dialogueConfig";
import { voicesConfig } from "../../src/config/voicesConfig";
import { VOICE_POST_NOTICES, VOICE_POST_OPTIONS, resolveVoicePostFormUrl, voicePostConfig } from "../../src/config/voicePostConfig";

let passed = 0;
function test(name: string, fn: () => void) {
  fn();
  passed++;
  console.log(`✓ ${name}`);
}

test("公開できないURLは無効になる（空欄・http・編集用URL）", () => {
  for (const url of ["", "   ", "未定", "http://forms.gle/abc", "https://docs.google.com/forms/d/abc123/edit"]) {
    assert.equal(resolveVoicePostFormUrl(url), null, url);
  }
});

test("サイト内の既存フォームは流用できない", () => {
  assert.equal(resolveVoicePostFormUrl(dialogueConfig.formUrl), null);
  assert.equal(resolveVoicePostFormUrl(voicesConfig.googleFormUrl), null);
});

test("別フォームのURLは有効になる", () => {
  const url = "https://docs.google.com/forms/d/e/OTHER/viewform";
  assert.equal(resolveVoicePostFormUrl(url), url);
});

test("正式なフォームが設定され、埋め込み用URLが組み立てられている", () => {
  const url = "https://docs.google.com/forms/d/e/1FAIpQLSfX-tqdj8dt4g0qvPTjupxEn-QlBbHFmZEQ4ITsO4foLCLrZw/viewform";
  assert.equal(voicePostConfig.formUrl, url);
  assert.equal(voicePostConfig.formEmbedUrl, `${url}?embedded=true`);
});

test("説明文と回答項目が指定の文言どおり", () => {
  assert.deepEqual(VOICE_POST_NOTICES, [
    "お寄せいただいたご意見は、福富千恵と延岡を動かす会が管理し、地域の福祉課題の把握や今後の活動・政策検討・提案の参考として活用します。",
    "個人が特定されないよう整理した集計結果を、公表したり関係機関等と共有したりする場合があります。",
    "氏名・施設名・病歴など、個人が特定される情報は入力しないでください。",
    "このフォームは延岡市の公式相談窓口ではありません。",
  ]);
  assert.deepEqual(VOICE_POST_OPTIONS, ["困っていること", "疑問に思うこと", "こうなったらいいな！"]);
});

test("非掲載の団体名とイベント限定の表現がページのソースに含まれない", () => {
  for (const file of ["src/pages/voice-post.astro", "src/config/voicePostConfig.ts"]) {
    const source = readFileSync(file, "utf8");
    assert.ok(!/エンタメ|実行委員会/.test(source), file);
    assert.ok(!/期間限定|イベント当日|11月22日|ファッションショー/.test(source), file);
  }
});

console.log(`\n${passed}件のテストに合格しました。`);
