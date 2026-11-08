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

test("正式なフォームが設定されている", () => {
  const url = "https://docs.google.com/forms/d/e/1FAIpQLSfX-tqdj8dt4g0qvPTjupxEn-QlBbHFmZEQ4ITsO4foLCLrZw/viewform";
  assert.equal(voicePostConfig.formUrl, url);
});

test("説明文が指定の文言どおり", () => {
  assert.deepEqual(VOICE_POST_NOTICES, [
    "お寄せいただいたご意見は、福富千恵と延岡を動かす会が管理し、地域の福祉課題の把握や今後の活動・政策検討・提案の参考として活用します。",
    "個人が特定されないよう整理した集計結果を、公表したり関係機関等と共有したりする場合があります。",
    "氏名・施設名・病歴など、個人が特定される情報は入力しないでください。",
    "このフォームは延岡市の公式相談窓口ではありません。",
  ]);
});

test("埋め込みを使わず、上部と下部のボタンからフォームを新しいタブで開く", () => {
  const source = readFileSync("src/pages/voice-post.astro", "utf8");
  assert.ok(!/<iframe|formEmbedUrl|embedded=true/.test(source));
  assert.equal(source.match(/href=\{formUrl\}\s+target="_blank"\s+rel="noopener noreferrer"/g)?.length, 2);
  assert.ok(source.includes('data-voice-post-form="top"') && source.includes('data-voice-post-form="bottom"'));
  assert.equal(source.match(/📮<\/span> みんなの声を届ける/g)?.length, 2);
});

test("3つの回答項目を説明として表示し、入力欄に見える部品を置かない", () => {
  const source = readFileSync("src/pages/voice-post.astro", "utf8");
  assert.deepEqual(VOICE_POST_OPTIONS, ["困っていること", "疑問に思うこと", "こうなったらいいな！"]);
  assert.ok(source.includes("VOICE_POST_OPTIONS.map"));
  assert.ok(source.includes("このページに入力欄はありません"));
  assert.ok(!/<input|<textarea|<select|<form|見本/.test(source));
  assert.ok(source.includes('const steps = ["あてはまる項目を選ぶ", "あなたの思いを書く", "送信する"];'));
});

test("非掲載の団体名とイベント限定の表現がページのソースに含まれない", () => {
  for (const file of ["src/pages/voice-post.astro", "src/config/voicePostConfig.ts"]) {
    const source = readFileSync(file, "utf8");
    assert.ok(!/エンタメ|実行委員会/.test(source), file);
    assert.ok(!/期間限定|イベント当日|11月22日|ファッションショー|募集期限|締切|締め切り/.test(source), file);
  }
});

console.log(`\n${passed}件のテストに合格しました。`);
