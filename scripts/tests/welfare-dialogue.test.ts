// 「福祉の現場の声を聴く 意見交換会」の掲載データ（src/data/welfareDialogue.ts）のテストです。
// 案内チラシ（PDF）と日時・曜日・会場が食い違っていないこと、構造化データの必須項目がそろっていることを確認します。
import assert from "node:assert/strict";
import {
  WELFARE_DIALOGUE_PDF_URL,
  WELFARE_DIALOGUE_SESSIONS,
  welfareDialogueEventSchemas,
  welfareSessionLabels,
} from "../../src/data/welfareDialogue";

let passed = 0;
function test(name: string, fn: () => void) {
  fn();
  passed++;
  console.log(`✓ ${name}`);
}

test("日時・曜日・会場がチラシの記載どおり", () => {
  const labels = WELFARE_DIALOGUE_SESSIONS.map((s) => {
    const { date, time } = welfareSessionLabels(s);
    return `第${s.round}回 ${date} ${time} ${s.facility}（${s.room}）`;
  });
  assert.deepEqual(labels, [
    "第1回 2026年11月14日（土） 18:00～ 東海コミュニティセンター（中会議室）",
    "第2回 2026年11月25日（水） 18:30～ 川中コミュニティセンター（小会議室2）",
    "第3回 2026年12月6日（日） 10:00～ 土々呂コミュニティセンター（中会議室）",
  ]);
});

test("各回を個別のEventとして出力し、必須項目がそろっている", () => {
  const schemas = welfareDialogueEventSchemas("2026-10-19");
  assert.equal(schemas.length, 3);
  for (const [i, schema] of schemas.entries()) {
    const session = WELFARE_DIALOGUE_SESSIONS[i];
    assert.equal(schema["@type"], "Event");
    assert.ok(schema.name.startsWith(`福祉の現場の声を聴く 意見交換会（第${session.round}回）`));
    assert.equal(schema.startDate, `${session.eventDate}T${session.startTime}:00+09:00`);
    assert.equal(schema.location.name, session.facility);
    assert.equal(schema.location.address.streetAddress, undefined, "住所（番地）は推測で入れない");
    assert.ok(schema.description);
    assert.equal(schema.organizer.name, "福富千恵と延岡を動かす会");
    assert.equal(schema.eventStatus, "https://schema.org/EventScheduled");
    assert.equal(schema.eventAttendanceMode, "https://schema.org/OfflineEventAttendanceMode");
    assert.equal(schema.url, "https://nobeoka-ugokasu.pages.dev/dialogue/");
  }
});

test("開催日を過ぎた回は構造化データに出さない", () => {
  assert.equal(welfareDialogueEventSchemas("2026-11-15").length, 2);
  assert.equal(welfareDialogueEventSchemas("2026-12-07").length, 0);
});

test("PDFは英数字のファイル名で /pdfs/ に置く", () => {
  assert.match(WELFARE_DIALOGUE_PDF_URL, /^\/pdfs\/[a-z0-9-]+\.pdf$/);
});

console.log(`\n${passed}件のテストに合格しました。`);
