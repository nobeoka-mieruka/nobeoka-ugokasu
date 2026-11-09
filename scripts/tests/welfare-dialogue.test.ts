// 「福祉の現場の声を聴く 意見交換会」の掲載データ（src/data/welfareDialogue.ts）のテストです。
// 案内チラシ（PDF）と日時・曜日・会場が食い違っていないこと、構造化データの必須項目がそろっていることを確認します。
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  WELFARE_DIALOGUE_DEADLINE_DAYS_BEFORE,
  WELFARE_DIALOGUE_PDF_URL,
  WELFARE_DIALOGUE_SESSIONS,
  welfareDialogueEvents,
  welfareDialogueEventSchemas,
  welfareDialogueState,
  welfareSessionDeadline,
  welfareSessionLabels,
  welfareSessionStatus,
} from "../../src/data/welfareDialogue";
import {
  renderDialogueFormApply,
  renderWelfareApply,
  renderWelfareBadge,
  renderWelfareSchemaScripts,
  renderWelfareSessionStatus,
} from "../../src/utils/welfareDialogueView";
import { todayInJapan } from "../../src/utils/dialogueEvents";
import { dialogueConfig } from "../../src/config/dialogueConfig";
import { hasOpenDialogueEvent } from "../../functions/dialogue/index";
import { DIALOGUE_FORM_URL } from "../monitor/site-check.mjs";

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

// ---- 受付状況の自動切り替え（日本時間の日付で判定） ----

const first = WELFARE_DIALOGUE_SESSIONS[0]; // 2026-11-14

test("申込締切は各開催日の2日前（第1回は11月12日まで）", () => {
  assert.equal(WELFARE_DIALOGUE_DEADLINE_DAYS_BEFORE, 2);
  assert.deepEqual(WELFARE_DIALOGUE_SESSIONS.map(welfareSessionDeadline), ["2026-11-12", "2026-11-23", "2026-12-04"]);
});

test("締切日までは受付中、締切の翌日から開催日当日までは受付終了、開催日の翌日から開催終了", () => {
  assert.equal(welfareSessionStatus(first, "2026-11-12"), "open");
  assert.equal(welfareSessionStatus(first, "2026-11-13"), "closed");
  assert.equal(welfareSessionStatus(first, "2026-11-14"), "closed");
  assert.equal(welfareSessionStatus(first, "2026-11-15"), "finished");
  // 月をまたぐ締切（12月6日 → 12月4日）
  assert.equal(welfareSessionStatus(WELFARE_DIALOGUE_SESSIONS[2], "2026-12-04"), "open");
  assert.equal(welfareSessionStatus(WELFARE_DIALOGUE_SESSIONS[2], "2026-12-05"), "closed");
});

test("日本時間で判定する（UTCでは前日の夜でも、日本時間の日付を使う）", () => {
  // 2026-11-12T15:30Z ＝ 日本時間 11月13日 0:30 → 第1回は受付終了
  assert.equal(welfareSessionStatus(first, todayInJapan(new Date("2026-11-12T15:30:00Z"))), "closed");
  // 2026-11-12T14:59Z ＝ 日本時間 11月12日 23:59 → まだ受付中
  assert.equal(welfareSessionStatus(first, todayInJapan(new Date("2026-11-12T14:59:00Z"))), "open");
});

test("Googleフォームの受付を止めた（WELFARE_DIALOGUE_FORM_ACCEPTING=false）ときは、締切前でも受付終了", () => {
  const state = welfareDialogueState("2026-11-01", false);
  assert.deepEqual(state.sessions.map((s) => s.status), ["closed", "closed", "closed"]);
  assert.equal(state.anyOpen, false);
});

test("第1回の締切後も、残る日程（第2回・第3回）の申込案内とボタンは維持する", () => {
  const state = welfareDialogueState("2026-11-13");
  assert.deepEqual(state.sessions.map((s) => s.status), ["closed", "open", "open"]);
  const top = renderWelfareApply(state, "top");
  assert.match(top, /受付中：第2回（11月25日（水））・第3回（12月6日（日））/);
  assert.equal((top.match(/data-welfare-apply /g) ?? []).length, 1, "申込ボタンは1つ");
  assert.ok(top.includes(`href="${dialogueConfig.formUrl}"`), "申込先は既存のGoogleフォームのまま");
  assert.ok(top.includes('data-track="dialogue_apply_click"') && top.includes('data-track-type="top"'), "GA4の計測（位置だけ。個人情報なし）");
  assert.match(renderWelfareBadge(state), /参加者募集中/);
  assert.match(renderWelfareSessionStatus(state.sessions[0]), /受付終了/);
  assert.match(renderWelfareSessionStatus(state.sessions[1]), /受付中.*申込締切：11月23日（月）まで/);
});

test("全日程の締切後は申込ボタンを出さず、受付終了を表示する。全日程の開催後は開催終了", () => {
  const closed = welfareDialogueState("2026-12-05");
  assert.equal(closed.anyOpen, false);
  assert.ok(!renderWelfareApply(closed, "bottom").includes("<a "), "申込ボタンを出さない");
  assert.match(renderWelfareApply(closed, "bottom"), /申込の受付は終了しました/);
  assert.match(renderWelfareBadge(closed), /申込受付を終了しました/);
  const finished = welfareDialogueState("2026-12-07");
  assert.equal(finished.allFinished, true);
  assert.match(renderWelfareApply(finished, "top"), /全3回の開催を終了しました/);
  assert.match(renderWelfareBadge(finished), /全日程の開催を終了しました/);
  assert.match(renderWelfareSessionStatus(finished.sessions[0]), /開催終了/);
  assert.ok(!renderWelfareSessionStatus(finished.sessions[0]).includes("申込締切"));
});

test("全回受付中のときは「受付中：…」の補足を出さない（3回とも申込できる）", () => {
  const state = welfareDialogueState("2026-11-01");
  assert.ok(!renderWelfareApply(state, "top").includes("受付中："));
});

test("構造化データ：締切後の回は受付終了（申込不可）として残し、開催日を過ぎた回は出さない", () => {
  const events = welfareDialogueEvents("2026-11-13");
  assert.deepEqual(events.map((e) => [e.status, e.applicationOpen]), [["closed", false], ["open", true], ["open", true]]);
  assert.equal(welfareDialogueEventSchemas("2026-11-13").length, 3);
  const scripts = renderWelfareSchemaScripts("2026-11-15");
  assert.equal((scripts.match(/application\/ld\+json/g) ?? []).length, 2);
  assert.ok(!scripts.includes("</script><script>alert"), "JSONは <script> から抜け出せない形で埋め込む");
});

test("意見交換会ページ下部の申込：受付中の回が無ければボタンを出さない。地域の意見交換会（D1）の受付中の回も考慮する", () => {
  assert.ok(renderDialogueFormApply(true).includes("data-dialogue-form-open"));
  assert.ok(!renderDialogueFormApply(false).includes("<a "));
  const base = { id: 1, title: "地域の意見交換会", eventDate: "2026-12-20", startTime: "10:00", endTime: "", venue: "会場", address: "", description: "", capacity: null, displayOrder: 1 };
  assert.equal(hasOpenDialogueEvent([{ ...base, status: "open", applicationOpen: true }], "2026-12-10"), true);
  assert.equal(hasOpenDialogueEvent([{ ...base, status: "open", applicationOpen: false }], "2026-12-10"), false);
  assert.equal(hasOpenDialogueEvent([{ ...base, status: "open", applicationOpen: true }], "2026-12-21"), false, "開催日を過ぎた回");
  assert.equal(hasOpenDialogueEvent([{ ...base, status: "closed", applicationOpen: true }], "2026-12-10"), false);
});

test("ページ：配信時に差し替える目印がそろい、申込フォームの埋め込み（iframe）と重複リンクが無い", () => {
  const section = readFileSync("src/components/WelfareDialogueSection.astro", "utf8");
  const page = readFileSync("src/pages/dialogue.astro", "utf8");
  const fn = readFileSync("functions/dialogue/index.ts", "utf8");
  for (const marker of ["data-welfare-badge", "data-welfare-status=", 'data-welfare-apply-area="top"', 'data-welfare-apply-area="bottom"', "data-welfare-schema"]) {
    assert.ok(section.includes(marker), `${marker} がページに無い`);
    assert.ok(fn.includes(marker.replace(/=$/, "")), `${marker} を配信時に差し替えていない`);
  }
  assert.ok(page.includes("data-dialogue-form-apply") && fn.includes("[data-dialogue-form-apply]"));
  assert.ok(!/<iframe/i.test(page), "申込フォームを埋め込まない（別タブで開くボタンに統一）");
  assert.ok(!section.includes("dialogueConfig.formUrl") && !page.includes("dialogueConfig.formUrl"), "申込フォームへのリンクは welfareDialogueView.ts の1か所で作る");
  assert.ok(!page.includes("welfareDialogueEventSchemas"), "構造化データをビルド時に固定しない（配信時に差し替える）");
});

test("申込フォームのURLは変更しない（定期チェックの確認先とも一致）", () => {
  assert.equal(dialogueConfig.formUrl, "https://docs.google.com/forms/d/e/1FAIpQLScmY6pGcRApiGwAgG2o0PaWqspnjv2cgqwg_tpaEKNkD5tLOQ/viewform");
  assert.equal(DIALOGUE_FORM_URL, dialogueConfig.formUrl);
});

console.log(`\n${passed}件のテストに合格しました。`);
