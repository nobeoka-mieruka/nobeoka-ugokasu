/**
 * 「福富千恵と延岡を動かす会」後援会入会申込用Googleフォームを自動作成するスクリプトです。
 *
 * 【使い方】
 * 1. https://script.google.com/ で新規プロジェクトを作成し、このファイルの内容を貼り付けます。
 * 2. 関数選択で createSupportersMembershipForm を選び、実行します（初回はGoogleアカウントの権限承認が必要です）。
 * 3. 実行完了後、「実行ログ」（表示メニュー → 実行数 / ログ）に出力される
 *    ・編集用URL
 *    ・回答用URL（フォームの回答用URL）
 *    ・埋め込み用URL
 *    ・回答スプレッドシートURL
 *    ・フォームID
 *    を確認し、回答用URLを src/config/supporters.ts の membershipFormUrl に、
 *    埋め込み用URLを membershipFormEmbedUrl に設定してください。
 * 4. 実行後、Googleフォームの編集画面を開き、フォームの設定（回答の受付、確認メッセージなど）が
 *    意図通りになっているか必ず目視で確認してください（本スクリプトはAPIで設定可能な項目のみ設定します）。
 *
 * 【重要：会費（年会費）に関する設問について】
 * 依頼時点の想定では「年会費1,000円」の確認設問を含める前提でしたが、
 * 実際の後援会規約PDF（public/pdfs/kouenkaikiyaku.pdf）第15条（経費）を確認したところ、
 * 「本会の経費は、寄附金及びその他の収入をもって充てる。」とあるのみで、
 * 会費（年会費）を定めた条文は規約に存在しませんでした。
 * 規約に書かれていない条件を追加しないという方針に従い、本スクリプトでは
 * 年会費の確認設問は作成していません。将来、規約が改正され会費が正式に定められた場合は、
 * その内容に基づいて設問を追加してください。
 *
 * 【本スクリプトでは追加していない項目】
 * 生年月日・年齢・性別・職業・勤務先・収入・政治的な考え方・支持政党・マイナンバー・
 * 本人確認書類・申込者や事務局の電話番号は、依頼内容に基づき一切追加していません。
 *
 * 【「みんなの声」フォームとの関係】
 * このスクリプトは後援会入会申込専用です。「みんなの声」の意見受付用Googleフォーム
 * （src/config/voicesConfig.ts の googleFormUrl）とは別のフォームであり、
 * 既存の「みんなの声」フォーム・スクリプトは変更していません。
 */
function createSupportersMembershipForm() {
  var form = FormApp.create('福富千恵と延岡を動かす会｜後援会入会申込');

  form.setDescription(
    '福富千恵と延岡を動かす会の後援会への入会をご希望の方は、後援会規約をご確認・ご同意のうえ、' +
    '以下の項目にご回答ください。\n' +
    '本会の経費は、規約に基づき寄附金及びその他の収入をもって充てられます。\n' +
    '送信いただいた内容は事務局で確認し、ご入力いただいたメールアドレスへご連絡します。' +
    '送信した時点で入会手続がすべて完了するものではありません。'
  );

  form.setCollectEmail(false); // メールアドレスはGoogleアカウントの自動収集ではなく、下記の記述式設問で取得します
  form.setProgressBar(true);
  form.setShuffleQuestions(false);
  form.setAllowResponseEdits(false);
  form.setLimitOneResponsePerUser(false);
  form.setPublishingSummary(false); // 他の回答者の回答・集計結果を表示しない

  form.setConfirmationMessage(
    '入会のお申込みを受け付けました。事務局で内容を確認後、ご入力いただいたメールアドレスへご連絡します。' +
    '送信した時点で入会手続がすべて完了するものではありませんので、事務局からの連絡をお待ちください。'
  );

  // ---- セクション1：申込者情報 ----
  form.addSectionHeaderItem().setTitle('申込者情報');

  form.addTextItem().setTitle('氏名').setRequired(true);
  form.addTextItem().setTitle('ふりがな').setRequired(true);

  var zip = form.addTextItem();
  zip.setTitle('郵便番号').setHelpText('例：882-0000').setRequired(true);
  zip.setValidation(
    FormApp.createTextValidation()
      .setHelpText('郵便番号の形式で入力してください（例：882-0000）')
      .requireTextMatchesPattern('^[0-9]{3}-?[0-9]{4}$')
      .build()
  );

  form.addParagraphTextItem().setTitle('住所').setRequired(true);

  var email = form.addTextItem();
  email.setTitle('メールアドレス').setRequired(true);
  email.setValidation(FormApp.createTextValidation().requireTextIsEmail().build());

  form.addTextItem().setTitle('紹介者').setHelpText('任意：ご紹介くださった方のお名前など').setRequired(false);
  form.addParagraphTextItem().setTitle('事務局への連絡事項').setRequired(false);

  // ---- セクション2：活動案内 ----
  form.addPageBreakItem().setTitle('活動案内');

  var guidance = form.addMultipleChoiceItem();
  guidance.setTitle('後援会からの活動案内').setRequired(true);
  guidance.setChoices([
    guidance.createChoice('メールでの活動案内を希望する'),
    guidance.createChoice('重要な連絡のみ希望する'),
    guidance.createChoice('活動案内は希望しない'),
  ]);

  var help = form.addCheckboxItem();
  help.setTitle('協力できる活動').setHelpText('任意：ご協力いただけそうな内容があればお選びください').setRequired(false);
  help.setChoices([
    help.createChoice('会合や座談会への参加'),
    help.createChoice('チラシ配布'),
    help.createChoice('ポスター掲示場所の紹介'),
    help.createChoice('イベントの準備や運営'),
    help.createChoice('SNSでの情報共有'),
    help.createChoice('事務作業'),
    help.createChoice('現時点では希望しない'),
    help.createChoice('その他'),
  ]);

  // ---- セクション3：規約・個人情報への同意 ----
  // Googleフォームの複数選択（チェックボックス）は「すべて選択」を必須にできないため、
  // 同意事項ごとに「選択肢が1つだけのチェックボックス設問」を個別に用意し、
  // それぞれに setRequired(true) を設定しています。
  form.addPageBreakItem().setTitle('規約・個人情報への同意');

  var consentRules = form.addCheckboxItem();
  consentRules.setTitle('後援会規約への同意').setRequired(true);
  consentRules.setChoices([
    consentRules.createChoice(
      '後援会規約を読み、内容を確認したうえで、福富千恵と延岡を動かす会への入会を申し込みます。'
    ),
  ]);

  var consentPrivacy = form.addCheckboxItem();
  consentPrivacy.setTitle('個人情報の取扱いへの同意').setRequired(true);
  consentPrivacy.setChoices([
    consentPrivacy.createChoice(
      '本会が入会申込みにあたり取得する氏名・ふりがな・住所・メールアドレス等の個人情報を、' +
      '入会手続及び後援会からのご連絡のために利用することに同意します。'
    ),
  ]);

  // ---- 回答用スプレッドシートの作成・連携 ----
  var spreadsheet = SpreadsheetApp.create('福富千恵と延岡を動かす会｜入会申込者一覧');
  form.setDestination(FormApp.DestinationType.SPREADSHEET, spreadsheet.getId());

  Logger.log('編集用URL: ' + form.getEditUrl());
  Logger.log('回答用URL: ' + form.getPublishedUrl());
  Logger.log('埋め込み用URL: ' + form.getPublishedUrl() + '?embedded=true');
  Logger.log('回答スプレッドシートURL: ' + spreadsheet.getUrl());
  Logger.log('フォームID: ' + form.getId());
}
